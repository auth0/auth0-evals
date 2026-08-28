/**
 * opencode agent runner.
 *
 * Spawns `opencode run <prompt> --dir <workspace> --model <provider/model>
 * --auto --format json` as a subprocess and parses the JSONL event stream
 * into a RunRecord.
 *
 * Authentication: routed through the LiteLLM proxy using the LLM API key —
 * the same token used by all other runners.
 *
 * Event format (--format json):
 *   NOTE: the exact event shape should be confirmed against a live
 *   `opencode run --format json` capture. Field names like `type`, `part`,
 *   and event type spellings (`tool_use`/`tool-use`, `step_finish`/`step-finish`)
 *   are assumed based on common JSONL agent patterns and may need adjustment.
 *
 * Config: written to <workspace>/opencode.jsonc so opencode auto-discovers it.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { RunRecord, ToolCallRecord, TurnMetric, EvalDefinition } from '@a0/evals-core';
import {
  OPENCODE_TASK_TIMEOUT_MS,
  MAX_TURNS,
  getFrameworkConfig,
  getAgentProxyBaseUrl,
  estimateCost,
  logger,
  filteredEnv,
  makeSessionId,
  mintMcpToken,
  mcpBearerTokenEnvVar,
} from '@a0/evals-core';
import { classifyActionType, classifyErrorCategory, detectRetry } from '@a0/evals-core';
import { OpencodeCliTranslator } from './translator.js';

const translator = new OpencodeCliTranslator();

/** Model identifier written to RunRecord when the opencode runner is used. */
export const OPENCODE_MODEL_ID = 'opencode';

/** Default model for the opencode runner. */
export const OPENCODE_DEFAULT_MODEL = 'llama-4-maverick-17b';

/**
 * Provider name used in opencode.jsonc and as the model prefix.
 * opencode `model` field uses `<provider>/<model>` syntax.
 */
export const OPENCODE_PROVIDER_NAME = 'llmproxy';

// ── Binary resolution ─────────────────────────────────────────────────────────

/**
 * Resolves the opencode binary path from node_modules (NOT PATH) using
 * createRequire so the binary is always the installed package version,
 * independent of $PATH.
 *
 * Throws a clear error if the binary cannot be located. The `opencode-ai`
 * package is a runtime dependency; if it is not installed this is a
 * configuration error rather than a code error.
 */
export function resolveOpencodeBin(): string {
  const require = createRequire(import.meta.url);
  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve('opencode-ai/package.json');
  } catch {
    throw new Error(
      '[opencode] Cannot resolve opencode-ai/package.json — is the opencode-ai package installed? ' +
        'Run: npm install opencode-ai',
    );
  }

  // package.json is at <pkgDir>/package.json; bin is typically at <pkgDir>/bin/opencode
  // or referenced in the package.json "bin" field.
  const pkgDir = pkgJsonPath.replace(/[/\\]package\.json$/, '');

  // Try common binary locations: node_modules/.bin/opencode, pkgDir/bin/opencode, pkgDir/opencode
  const candidates = [
    join(pkgDir, '..', '.bin', 'opencode'),
    join(pkgDir, 'bin', 'opencode'),
    join(pkgDir, 'opencode'),
  ];

  for (const candidate of candidates) {
    // Dynamic require handles existence check — spawn will error if wrong.
    // We rely on the fact that if the package is installed, at least one of
    // these will exist. Return the first that looks plausible.
    try {
      // Attempt to read the file to verify it exists.
      require.resolve(candidate);
      return candidate;
    } catch {
      // Not found at this path — try next.
    }
  }

  // Fall back to the node_modules/.bin symlink resolution via the package's bin field.
  // If none of the candidates resolve, the first candidate is still the most likely
  // location and spawn will give a clear OS error.
  return candidates[0]!;
}

// ── Config writer ─────────────────────────────────────────────────────────────

export interface OpencodeConfigResult {
  mcpServerNames: string[];
  /** Minted Bearer tokens keyed by the env var name each `{env:VAR}` reference resolves to. */
  bearerTokens: Record<string, string>;
}

/**
 * Writes <workspace>/opencode.jsonc with the provider, model, MCP, and
 * skills configuration for one eval run.
 *
 * IMPORTANT: never writes the raw LLM_API_KEY or raw bearer tokens into the
 * file — only `{env:VAR}` placeholders. Tokens are returned in `bearerTokens`
 * so the caller can inject them into the subprocess env.
 *
 * small_model MUST be pinned to the same model — opencode's title/summary/
 * compaction calls otherwise default to a built-in model id the proxy will
 * 400 on. This is the #1 correctness trap for this runner.
 */
export async function writeOpencodeConfig(
  workspace: string,
  model: string,
  opts: { tools: string[] },
): Promise<OpencodeConfigResult> {
  const { tools } = opts;

  const proxyBaseUrl = getAgentProxyBaseUrl('opencode');
  const normalizedBaseUrl = proxyBaseUrl.replace(/\/+$/, '');
  const baseURL = normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;

  const modelRef = `${OPENCODE_PROVIDER_NAME}/${model}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: Record<string, any> = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      [OPENCODE_PROVIDER_NAME]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'LLM Proxy',
        options: {
          baseURL,
          // {env:LLM_API_KEY} is an opencode env-var placeholder — the raw key
          // is NEVER written to this file. It is injected into the subprocess env.
          apiKey: '{env:LLM_API_KEY}',
        },
        models: {
          [model]: { name: model },
        },
      },
    },
    model: modelRef,
    // small_model MUST be pinned to the same model — opencode's title/summary/
    // compaction calls otherwise default to a built-in model id the proxy will
    // 400 on. #1 correctness trap.
    small_model: modelRef,
  };

  const mcpServerNames: string[] = [];
  const bearerTokens: Record<string, string> = {};

  if (tools.includes('mcp')) {
    const mcpServers: Record<string, unknown> = {};
    const configServers = getFrameworkConfig().mcp.servers;

    for (const [name, server] of Object.entries(configServers)) {
      if (server.type !== 'http') continue;

      if (server.auth) {
        const token = await mintMcpToken(server.auth);
        if (!token) {
          logger.warn(`[opencode] MCP server '${name}' skipped — token mint failed or creds missing`);
          continue;
        }
        const envVar = mcpBearerTokenEnvVar(name);
        if (bearerTokens[envVar] !== undefined) {
          logger.warn(
            `[opencode] MCP server '${name}' skipped — env var ${envVar} already used by another server (name collision)`,
          );
          continue;
        }
        bearerTokens[envVar] = token;
        mcpServers[name] = {
          type: 'remote',
          url: server.url,
          enabled: true,
          // {env:VAR} placeholder — raw token is injected via subprocess env, never written here.
          headers: { Authorization: `Bearer {env:${envVar}}` },
        };
      } else {
        mcpServers[name] = { type: 'remote', url: server.url, enabled: true };
      }
      mcpServerNames.push(name);
    }

    if (Object.keys(mcpServers).length > 0) {
      config.mcp = mcpServers;
    }
  }

  writeFileSync(join(workspace, 'opencode.jsonc'), JSON.stringify(config, null, 2), 'utf-8');
  return { mcpServerNames, bearerTokens };
}

// ── Event type normalisation ──────────────────────────────────────────────────

/**
 * Normalises opencode event type strings to a canonical form.
 * opencode may emit `tool_use`, `tool-use`, `step_finish`, `step-finish`, etc.
 * Accept both underscore and hyphen spellings.
 *
 * NOTE: confirm these type values against a live `--format json` capture.
 */
function normaliseEventType(raw: string): string {
  return raw.replace(/-/g, '_');
}

// ── Runner ────────────────────────────────────────────────────────────────────

export interface OpencodeRunOptions {
  /** Tool flags (e.g. ['mcp', 'skills']). */
  tools?: string[];
  /** opencode model to use. Defaults to OPENCODE_DEFAULT_MODEL. */
  model?: string;
}

/**
 * Runs an opencode agent against an eval and returns a RunRecord compatible
 * with the scorer and serialisers used by the standard agent pipeline.
 */
export async function runOpencodeAgent(
  evalDef: Pick<EvalDefinition, 'id' | 'userPrompt'>,
  workspace: string,
  opts: OpencodeRunOptions = {},
): Promise<RunRecord> {
  const { tools = [], model = OPENCODE_DEFAULT_MODEL } = opts;

  const record: RunRecord = {
    taskName: evalDef.id,
    model,
    sessionId: makeSessionId(),
    startTime: Date.now() / 1000,
    endTime: 0,
    toolCalls: [],
    turnMetrics: [],
    providerErrors: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    status: 'running',
    finalSummary: '',
    workspace,
  };

  logger.info(`\n[opencode] Starting task: ${evalDef.id}`);
  logger.info(`[opencode] Workspace: ${workspace}`);
  logger.info(`[opencode] Model: ${model}`);

  const { mcpServerNames, bearerTokens } = await writeOpencodeConfig(workspace, model, { tools });

  if (mcpServerNames.length > 0) {
    logger.info(`[opencode] MCP: ${mcpServerNames.join(', ')}`);
  } else if (tools.includes('mcp')) {
    logger.warn(`[opencode] --tools mcp requested but no MCP servers are available`);
  }

  let bin: string;
  try {
    bin = resolveOpencodeBin();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record.providerErrors.push(`binary resolution error: ${msg}`);
    record.status = 'failure';
    record.endTime = Date.now() / 1000;
    logger.error(`[opencode] ✗ ${msg}`);
    return record;
  }

  const opencodeEnv: Record<string, string> = {
    ...filteredEnv(),
  };
  if (process.env.LLM_API_KEY) {
    opencodeEnv.LLM_API_KEY = process.env.LLM_API_KEY;
  } else {
    logger.warn(`[opencode] LLM_API_KEY not set — requests will fail.`);
  }
  if (process.env.GH_TOKEN) {
    opencodeEnv.GH_TOKEN = process.env.GH_TOKEN;
  }
  // Inject minted Bearer tokens so opencode can resolve each authed server's
  // `{env:MCP_BEARER_*}` header reference from the opencode.jsonc config.
  for (const [key, value] of Object.entries(bearerTokens)) {
    opencodeEnv[key] = value;
  }

  // Pending tool calls: tool_id → { name, args, startTime }
  const pending = new Map<string, { name: string; args: Record<string, unknown>; startTime: number }>();

  // Turn tracking — one TurnMetric per step_finish event.
  let turnLimitReached = false;
  let turnNum = 0;
  let turnToolCount = 0;
  let turnStartTime = record.startTime;

  const args: string[] = [
    'run',
    evalDef.userPrompt,
    '--dir',
    workspace,
    '--model',
    `${OPENCODE_PROVIDER_NAME}/${model}`,
    '--auto',
    '--format',
    'json',
  ];

  return new Promise<RunRecord>((resolve) => {
    const child = spawn(bin, args, { cwd: workspace, env: opencodeEnv });

    const taskTimeout = setTimeout(() => {
      record.providerErrors.push(`task timeout after ${OPENCODE_TASK_TIMEOUT_MS / 1000}s`);
      record.status = 'failure';
      logger.info(`[opencode] ✗ Task timeout — killing`);
      child.kill('SIGTERM');
    }, OPENCODE_TASK_TIMEOUT_MS);

    const stderrChunks: Buffer[] = [];
    if (child.stderr) {
      child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
    }

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          logger.warn(`[opencode] Non-JSON stdout: ${trimmed.slice(0, 120)}`);
          return;
        }

        // NOTE: opencode's exact event type field and values should be confirmed
        // against a live `--format json` capture. We accept both `type` at the
        // top level and a `part.type` nesting (some JSONL agents wrap events).
        const rawType = (event.type ?? (event.part as Record<string, unknown> | undefined)?.type ?? '') as string;
        const type = normaliseEventType(rawType);

        switch (type) {
          case 'tool_use': {
            // NOTE: field names `tool_name`/`name`, `tool_id`/`id`, `parameters`/`input`
            // should be confirmed against a live capture.
            const toolName = (event.tool_name ?? event.name ?? 'unknown') as string;
            const toolId = (event.tool_id ?? event.id ?? String(Date.now())) as string;
            const params = (event.parameters ?? event.input ?? {}) as Record<string, unknown>;

            if (translator.isInternalTool(toolName)) break;

            pending.set(toolId, { name: toolName, args: params, startTime: Date.now() / 1000 });
            turnToolCount++;
            break;
          }

          case 'tool_result': {
            // NOTE: field names should be confirmed against a live capture.
            const toolId = (event.tool_id ?? event.id ?? '') as string;
            const pend = pending.get(toolId);
            if (pend) pending.delete(toolId);

            const output = (event.output ?? event.content ?? '') as string;
            const isError = event.status === 'error' || event.is_error === true;
            const rawName = pend?.name ?? 'unknown';
            const mappedName = translator.mapName(rawName);
            const toolArgs = translator.normalizeArgs(rawName, pend?.args ?? {});
            const startTime = pend?.startTime ?? Date.now() / 1000;
            const endTime = Date.now() / 1000;
            const elapsed = ((endTime - startTime) * 1000).toFixed(0);
            const preview = output.slice(0, 80).replace(/\n/g, ' ');

            if (isError) {
              logger.error(`  [opencode] ${mappedName} ✗ (${elapsed}ms) ${preview}`);
            } else {
              logger.info(`  [opencode] ${mappedName} ✓ (${elapsed}ms)${preview ? ` → ${preview}` : ''}`);
            }

            const isRetry = detectRetry(record.toolCalls, mappedName, toolArgs);
            const tc: ToolCallRecord = {
              name: mappedName,
              args: toolArgs,
              result: output,
              startTime,
              endTime,
              isDocLookup: translator.isDocLookup(rawName),
              isInterruption: translator.isInterruption(rawName),
              causedError: isError,
              actionType: classifyActionType(mappedName, isError),
              isRetry,
              recoveredFromError: isRetry && !isError,
            };
            if (isError) tc.errorCategory = classifyErrorCategory(output);
            record.toolCalls.push(tc);
            break;
          }

          case 'step_finish': {
            // NOTE: token field names (`tokens.input`, `tokens.output`, `tokens.reasoning`,
            // `tokens.cache.read`, `tokens.cache.write`, `cost`) should be confirmed
            // against a live capture.
            const tokens = (event.tokens ?? {}) as Record<string, unknown>;
            const cache = (tokens.cache ?? {}) as Record<string, unknown>;
            const inputTokens = ((tokens.input as number) ?? 0) + ((cache.read as number) ?? 0);
            const outputTokens =
              ((tokens.output as number) ?? 0) + ((tokens.reasoning as number) ?? 0) + ((cache.write as number) ?? 0);
            const reportedCost = event.cost as number | undefined;

            record.inputTokens += inputTokens;
            record.outputTokens += outputTokens;

            const turnCost =
              typeof reportedCost === 'number' && reportedCost > 0
                ? reportedCost
                : estimateCost(model, inputTokens, outputTokens);
            record.costUsd += turnCost;

            turnNum++;
            const turnEndTime = Date.now() / 1000;
            const tm: TurnMetric = {
              turn: turnNum,
              inputTokens,
              outputTokens,
              llmLatency: Math.max(0, turnEndTime - turnStartTime),
              finishReason: turnToolCount > 0 ? 'tool_calls' : 'stop',
              toolCallCount: turnToolCount,
              costUsd: turnCost,
            };
            record.turnMetrics.push(tm);
            turnStartTime = turnEndTime;

            logger.info(
              `[opencode] Turn ${turnNum}: ${inputTokens}in/${outputTokens}out tokens, ` +
                `${turnToolCount} tool(s), cost=$${turnCost.toFixed(4)}`,
            );
            turnToolCount = 0;

            if (!turnLimitReached && turnNum >= MAX_TURNS) {
              turnLimitReached = true;
              record.providerErrors.push(`turn limit: stopped after ${MAX_TURNS} turns`);
              record.status = 'failure';
              logger.info(`[opencode] ✗ Turn limit reached (${MAX_TURNS}) — killing`);
              child.kill('SIGTERM');
            }
            break;
          }

          case 'text':
          case 'assistant_message':
          case 'message': {
            // Capture the final assistant text output as the summary.
            const content = (event.content ?? event.text ?? '') as string;
            if (content) record.finalSummary = content;
            break;
          }

          case 'error': {
            const msg = (event.message ?? event.error ?? String(event)) as string;
            record.providerErrors.push(msg);
            logger.error(`[opencode] Event error: ${msg}`);
            break;
          }

          default:
            // Unknown event types are silently ignored to be forward-compatible.
            break;
        }
      });
    }

    child.on('close', (code) => {
      clearTimeout(taskTimeout);

      // Drain tool_use events that never received a tool_result (e.g. on timeout
      // or unexpected exit) so we don't silently lose tool-call metrics.
      for (const [, pend] of pending) {
        const mappedName = translator.mapName(pend.name);
        const tc: ToolCallRecord = {
          name: mappedName,
          args: translator.normalizeArgs(pend.name, pend.args),
          result: '',
          startTime: pend.startTime,
          endTime: Date.now() / 1000,
          isDocLookup: translator.isDocLookup(pend.name),
          isInterruption: translator.isInterruption(pend.name),
          causedError: true,
          actionType: classifyActionType(mappedName, true),
          isRetry: false,
          recoveredFromError: false,
          errorCategory: 'unknown',
        };
        record.toolCalls.push(tc);
        record.providerErrors.push(`orphaned tool call: ${pend.name}`);
      }
      pending.clear();

      if (code !== 0 && record.status !== 'failure') {
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
        if (record.toolCalls.length === 0 && !record.finalSummary) {
          const msg = `opencode exited with code ${code ?? 1}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`;
          record.providerErrors.push(msg);
          record.status = 'failure';
          logger.error(`[opencode] ✗ ${msg}`);
        }
      }

      record.endTime = Date.now() / 1000;
      if (record.status === 'running') {
        record.status = record.toolCalls.length > 0 || record.finalSummary ? 'success' : 'failure';
        if (record.status === 'failure') {
          record.providerErrors.push('no output received');
        }
      }

      logger.info(
        `[opencode] Done — status=${record.status} turns=${turnNum} ` +
          `tools=${record.toolCalls.length} cost=$${record.costUsd.toFixed(4)}`,
      );
      resolve(record);
    });

    child.on('error', (err) => {
      clearTimeout(taskTimeout);
      record.providerErrors.push(`spawn error: ${err.message}`);
      record.status = 'failure';
      record.endTime = Date.now() / 1000;
      logger.error(`[opencode] ✗ Spawn error: ${err.message}`);
      resolve(record);
    });
  });
}
