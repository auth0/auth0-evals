/**
 * Gemini CLI agent runner.
 *
 * Spawns `gemini -p <prompt> --approval-mode yolo -o stream-json -m <model>`
 * as a subprocess and parses the JSONL event stream into a RunRecord.
 *
 * Authentication: routed through the LiteLLM proxy using the LLM API key —
 * the same token used by all other runners.
 *
 * Event format (stream-json):
 *   {"type":"init",        "session_id":"...", "model":"..."}
 *   {"type":"tool_use",    "tool_name":"...", "tool_id":"...", "parameters":{...}}
 *   {"type":"tool_result", "tool_id":"...",   "status":"success|error", "output":"..."}
 *   {"type":"message",     "role":"assistant","content":"...", "delta":true}
 *   {"type":"result",      "status":"success","stats":{total_tokens, input_tokens, output_tokens, tool_calls, ...}}
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord, ToolCallRecord, TurnMetric, EvalDefinition } from '@a0/eval-core';
import {
  CLAUDE_CODE_TASK_TIMEOUT_MS,
  MAX_TURNS,
  getFrameworkConfig,
  getAgentProxyBaseUrl,
  estimateCost,
  logger,
  filteredEnv,
  mintMcpToken,
} from '@a0/eval-core';
import { classifyActionType, classifyErrorCategory, detectRetry } from '@a0/eval-core';
import { LLM_API_KEY_ENV } from '../../cli/constants.js';
import { GeminiCliTranslator } from './translator.js';

const translator = new GeminiCliTranslator();

/** Model identifier written to RunRecord when Gemini CLI runner is used. */
export const GEMINI_CLI_MODEL_ID = 'gemini-cli';

/** Default model — flash has a higher free-tier quota than pro. */
export const GEMINI_CLI_DEFAULT_MODEL = 'gemini-3.1-pro-preview';

/**
 * Auth method pinned in .gemini/settings.json. Gemini CLI 0.45+ added a new
 * `gateway` auth type that getAuthTypeFromEnv() returns whenever
 * GOOGLE_GEMINI_BASE_URL is set — and it checks that before GEMINI_API_KEY. But
 * the non-interactive validator (validateAuthMethod) has no `gateway` case, so
 * it rejects the run with "Invalid auth method selected." We route through a
 * proxy (GOOGLE_GEMINI_BASE_URL) and authenticate with GEMINI_API_KEY, so we
 * pin the validated `gemini-api-key` type explicitly. The CLI prefers the
 * configured auth type over env detection, and `gemini-api-key` still honours
 * GOOGLE_GEMINI_BASE_URL for the endpoint, so proxy routing is preserved.
 */
const GEMINI_AUTH_TYPE = 'gemini-api-key';

/** Reuse the Claude Code timeout budget. */
const GEMINI_CLI_TIMEOUT_MS = CLAUDE_CODE_TASK_TIMEOUT_MS;

/**
 * Detects a Gemini CLI command auto-cancellation notice in tool output. The CLI
 * cancels a command exceeding its own per-command timeout but reports the result
 * with status:"success", so the only signal is this text in the output.
 */
function isAutoCancelled(output: string): boolean {
  return /automatically cancelled because it exceeded the timeout/i.test(output);
}

/**
 * Writes <workspace>/.gemini/settings.json so the Gemini CLI picks up our
 * config for the duration of the eval run. Always pins the auth method (see
 * GEMINI_AUTH_TYPE); when `includeMcp` is set, also registers the configured
 * HTTP MCP servers.
 *
 * Gemini CLI discovers per-project config from <workspace>/.gemini/settings.json.
 * MCP tool calls appear in the stream-json output as tool_use events with names
 * using the format `mcp__<serverName>__<toolName>` (e.g. `mcp__auth0-docs__search_auth0_docs`).
 *
 * For HTTP servers with an `auth` block, mints a fresh Bearer token per job
 * (client-credentials exchange) and writes it as an `Authorization` header into
 * the server config. If the token mint fails, the server is skipped with a
 * warning rather than registered unauthenticated.
 *
 * Returns the names of the registered MCP servers (empty when MCP is disabled).
 */
interface GeminiMcpServer {
  httpUrl: string;
  timeout: number;
  headers?: Record<string, string>;
}

async function writeGeminiSettings(workspace: string, includeMcp: boolean): Promise<string[]> {
  const settings: {
    security: { auth: { selectedType: string } };
    mcpServers?: Record<string, GeminiMcpServer>;
  } = {
    security: { auth: { selectedType: GEMINI_AUTH_TYPE } },
  };

  const mcpServers: Record<string, GeminiMcpServer> = {};
  if (includeMcp) {
    const configServers = getFrameworkConfig().mcp.servers;
    for (const [name, server] of Object.entries(configServers)) {
      if (server.type !== 'http') continue;
      if (server.auth) {
        const token = await mintMcpToken(server.auth);
        if (!token) {
          logger.warn(`[GeminiCLI] MCP server '${name}' skipped — token mint failed or creds missing`);
          continue;
        }
        mcpServers[name] = {
          httpUrl: server.url,
          timeout: 30000,
          headers: { Authorization: `Bearer ${token}` },
        };
      } else {
        mcpServers[name] = { httpUrl: server.url, timeout: 30000 };
      }
    }
    if (Object.keys(mcpServers).length > 0) settings.mcpServers = mcpServers;
  }

  const geminiDir = join(workspace, '.gemini');
  mkdirSync(geminiDir, { recursive: true });
  writeFileSync(join(geminiDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');
  return Object.keys(mcpServers);
}

/**
 * Writes a trustedFolders.json that trusts only the given workspace directory.
 * Callers must set GEMINI_CLI_TRUSTED_FOLDERS_PATH in the subprocess env to
 * the returned path so Gemini CLI picks it up instead of ~/.gemini/trustedFolders.json.
 */
function writeTrustedFolders(workspace: string): string {
  const geminiDir = join(workspace, '.gemini');
  mkdirSync(geminiDir, { recursive: true });
  const filePath = join(geminiDir, 'trustedFolders.json');
  writeFileSync(filePath, JSON.stringify({ [workspace]: 'TRUST_FOLDER' }, null, 2), 'utf-8');
  return filePath;
}

export interface GeminiCliRunOptions {
  /** Tool flags (e.g. ['mcp', 'skills']). */
  tools?: string[];
  /** Gemini model to use. Defaults to GEMINI_CLI_DEFAULT_MODEL. */
  model?: string;
}

/**
 * Runs a Gemini CLI agent against an eval and returns a RunRecord compatible
 * with the scorer and serialisers used by the standard agent pipeline.
 */
export async function runGeminiCliAgent(
  evalDef: Pick<EvalDefinition, 'id' | 'userPrompt'>,
  workspace: string,
  opts: GeminiCliRunOptions = {},
): Promise<RunRecord> {
  const { tools = [], model = GEMINI_CLI_DEFAULT_MODEL } = opts;

  const record: RunRecord = {
    taskName: evalDef.id,
    model,
    sessionId: Math.random().toString(36).slice(2, 10),
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

  logger.info(`\n[GeminiCLI] Starting task: ${evalDef.id}`);
  logger.info(`[GeminiCLI] Workspace: ${workspace}`);
  logger.info(`[GeminiCLI] Model: ${model}`);
  const mcpNames = await writeGeminiSettings(workspace, tools.includes('mcp'));
  if (mcpNames.length > 0) logger.info(`[GeminiCLI] MCP: ${mcpNames.join(', ')}`);

  // Trust only this workspace so YOLO mode isn't overridden in CI/headless environments.
  const trustedFoldersPath = writeTrustedFolders(workspace);

  const args: string[] = ['-p', evalDef.userPrompt, '--approval-mode', 'yolo', '-o', 'stream-json', '-m', model];

  const geminiEnv: Record<string, string> = {
    ...filteredEnv(),
    GEMINI_CLI_TRUSTED_FOLDERS_PATH: trustedFoldersPath,
    GEMINI_CLI_TRUST_WORKSPACE: 'true',
  };
  if (process.env.GH_TOKEN) {
    geminiEnv.GH_TOKEN = process.env.GH_TOKEN;
  }
  if (process.env[LLM_API_KEY_ENV]) {
    geminiEnv.GOOGLE_GEMINI_BASE_URL = getAgentProxyBaseUrl('gemini-cli');
    geminiEnv.GEMINI_API_KEY = process.env[LLM_API_KEY_ENV]!;
  } else {
    logger.warn(`[GeminiCLI] ${LLM_API_KEY_ENV} not set — requests will fail.`);
  }

  // Pending tool calls: tool_id → { name, args, startTime }
  const pending = new Map<string, { name: string; args: Record<string, unknown>; startTime: number }>();

  // Turn tracking — one TurnMetric per assistant message batch.
  let turnLimitReached = false;
  let turnNum = 0;
  let turnToolCount = 0;
  let turnStartTime = record.startTime;
  // True once we've seen at least one delta chunk for the current turn but
  // haven't yet received a closing non-delta message.  Flushed at result time
  // when the Gemini CLI omits the final non-delta message (streaming-only mode).
  let pendingDeltaTurn = false;

  return new Promise<RunRecord>((resolve) => {
    const child = spawn('gemini', args, { cwd: workspace, env: geminiEnv });

    const taskTimeout = setTimeout(() => {
      record.providerErrors.push(`task timeout after ${GEMINI_CLI_TIMEOUT_MS / 1000}s`);
      record.status = 'failure';
      logger.info(`[GeminiCLI] ✗ Task timeout — killing`);
      child.kill('SIGTERM');
    }, GEMINI_CLI_TIMEOUT_MS);

    const stderrChunks: Buffer[] = [];
    if (child.stderr) {
      child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
    }

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('YOLO mode')) return;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          logger.warn(`[GeminiCLI] Non-JSON stdout: ${trimmed.slice(0, 120)}`);
          return;
        }

        const type = event.type as string;

        switch (type) {
          case 'init':
            record.sessionId = (event.session_id as string) ?? record.sessionId;
            logger.info(`[GeminiCLI] Session ${record.sessionId}`);
            break;

          case 'tool_use': {
            const toolName = (event.tool_name as string) ?? 'unknown';
            const toolId = (event.tool_id as string) ?? String(Date.now());
            const params = (event.parameters ?? {}) as Record<string, unknown>;
            pending.set(toolId, { name: toolName, args: params, startTime: Date.now() / 1000 });
            turnToolCount++;
            break;
          }

          case 'tool_result': {
            const toolId = (event.tool_id as string) ?? '';
            const pend = pending.get(toolId);
            if (pend) pending.delete(toolId);

            const output = (event.output as string) ?? '';
            // Gemini CLI cancels a command that exceeds its own internal timeout but
            // still reports status:"success", placing the cancellation notice only in
            // the output text. Treat that as an error so it counts against scoring.
            const isError = event.status !== 'success' || isAutoCancelled(output);
            const rawName = pend?.name ?? 'unknown';
            const mappedName = translator.mapName(rawName);
            const toolArgs = translator.normalizeArgs(rawName, pend?.args ?? {});
            const startTime = pend?.startTime ?? Date.now() / 1000;
            const endTime = Date.now() / 1000;
            const elapsed = ((endTime - startTime) * 1000).toFixed(0);
            const preview = output.slice(0, 80).replace(/\n/g, ' ');

            if (isError) {
              logger.error(`  [GeminiCLI] ${mappedName} ✗ (${elapsed}ms) ${preview}`);
            } else {
              logger.info(`  [GeminiCLI] ${mappedName} ✓ (${elapsed}ms)${preview ? ` → ${preview}` : ''}`);
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

          case 'message': {
            if ((event.role as string) === 'assistant') {
              const content = (event.content as string) ?? '';
              if (content) record.finalSummary = content;

              if (event.delta === true) {
                // Streaming chunk — mark that a turn is in progress but don't
                // close it yet; the non-delta message (or result event) will do that.
                pendingDeltaTurn = true;
              } else {
                // Non-delta: the turn is complete.
                pendingDeltaTurn = false;
                turnNum++;
                const turnEndTime = Date.now() / 1000;
                const tm: TurnMetric = {
                  turn: turnNum,
                  inputTokens: 0,
                  outputTokens: 0,
                  llmLatency: Math.max(0, turnEndTime - turnStartTime),
                  finishReason: turnToolCount > 0 ? 'tool_calls' : 'stop',
                  toolCallCount: turnToolCount,
                  costUsd: 0,
                };
                record.turnMetrics.push(tm);
                turnStartTime = turnEndTime;
                logger.info(`[GeminiCLI] Turn ${turnNum}: ${turnToolCount} tool(s)`);
                turnToolCount = 0;
                if (!turnLimitReached && turnNum >= MAX_TURNS) {
                  turnLimitReached = true;
                  record.providerErrors.push(`turn limit: stopped after ${MAX_TURNS} turns`);
                  record.status = 'failure';
                  logger.info(`[GeminiCLI] ✗ Turn limit reached (${MAX_TURNS}) — killing`);
                  child.kill('SIGTERM');
                }
              }
            }
            break;
          }

          case 'result': {
            const stats = (event.stats ?? {}) as Record<string, unknown>;
            const inputTokens = (stats.input_tokens as number) ?? 0;
            const outputTokens = (stats.output_tokens as number) ?? 0;
            const durationMs = (stats.duration_ms as number) ?? 0;
            const totalToolCalls = (stats.tool_calls as number) ?? 0;

            // Flush a pending delta-only turn — the Gemini CLI can emit streaming
            // chunks (delta:true) without a closing non-delta message when the
            // session runs in streaming-only mode.
            if (pendingDeltaTurn) {
              pendingDeltaTurn = false;
              turnNum++;
              const tm: TurnMetric = {
                turn: turnNum,
                inputTokens: 0,
                outputTokens: 0,
                // durationMs comes from the result stats — authoritative wall time
                // for this turn. Delta streaming means the turn ended with text output.
                llmLatency: Math.max(0, durationMs / 1000),
                finishReason: 'stop',
                toolCallCount: turnToolCount,
                costUsd: 0,
              };
              record.turnMetrics.push(tm);
              turnToolCount = 0;

              if (!turnLimitReached && turnNum >= MAX_TURNS) {
                turnLimitReached = true;
                record.providerErrors.push(`turn limit: stopped after ${MAX_TURNS} turns`);
                record.status = 'failure';
                logger.info(`[GeminiCLI] ✗ Turn limit reached (${MAX_TURNS}) — killing`);
                child.kill('SIGTERM');
              }
            }

            record.inputTokens = inputTokens;
            record.outputTokens = outputTokens;
            record.costUsd = estimateCost(model, inputTokens, outputTokens);

            // Back-fill the last TurnMetric with authoritative stats.
            const last = record.turnMetrics[record.turnMetrics.length - 1];
            if (last) {
              last.inputTokens = inputTokens;
              last.outputTokens = outputTokens;
              last.llmLatency = durationMs / 1000;
              last.costUsd = record.costUsd;
            }

            logger.info(
              `[GeminiCLI] Turn ${turnNum}: ${inputTokens}in/${outputTokens}out tokens, ` +
                `${totalToolCalls} tool(s), cost=$${record.costUsd.toFixed(4)}`,
            );
            break;
          }
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
        // Gemini CLI exits non-zero on 503 retries but may still have completed
        // the task. Only treat as failure if there's nothing to show.
        if (record.toolCalls.length === 0 && !record.finalSummary) {
          const msg = `gemini exited with code ${code ?? 1}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`;
          record.providerErrors.push(msg);
          record.status = 'failure';
          logger.error(`[GeminiCLI] ✗ ${msg}`);
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
        `[GeminiCLI] Done — status=${record.status} turns=${turnNum} ` +
          `tools=${record.toolCalls.length} cost=$${record.costUsd.toFixed(4)}`,
      );
      resolve(record);
    });

    child.on('error', (err) => {
      clearTimeout(taskTimeout);
      record.providerErrors.push(`spawn error: ${err.message}`);
      record.status = 'failure';
      record.endTime = Date.now() / 1000;
      logger.error(`[GeminiCLI] ✗ Spawn error: ${err.message}`);
      resolve(record);
    });
  });
}
