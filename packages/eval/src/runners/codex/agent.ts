/**
 * Codex CLI agent runner.
 *
 * Spawns `codex exec <prompt> --skip-git-repo-check --json --sandbox danger-full-access`
 * as a subprocess and parses the JSON Lines event stream into a RunRecord.
 *
 * Authentication: routed through the configured proxy using the LLM API key —
 * the same token used by all other runners. Codex is configured with
 * wire_api = "responses" so it uses the REST-based Responses API (not websockets),
 * which the proxy supports natively.
 *
 * Event format (--json):
 *   {"type":"thread.started",       "thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"function_call",        "name":"...", "call_id":"...", "arguments":"..."}
 *   {"type":"function_call_output", "call_id":"...", "output":"..."}
 *   {"type":"message",              "role":"assistant", "content":"..."}
 *   {"type":"item.completed",       "item":{"type":"agent_message"|"function_call"|"function_call_output", ...}}
 *   {"type":"turn.completed",       "usage":{"input_tokens":N,"output_tokens":M}}
 *   {"type":"error",                "message":"..."}
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { RunRecord, ToolCallRecord, TurnMetric, EvalDefinition } from '@a0/eval-core';
import {
  CODEX_TASK_TIMEOUT_MS,
  MAX_TURNS,
  getAgentProxyBaseUrl,
  estimateCost,
  logger,
  filteredEnv,
} from '@a0/eval-core';
import { classifyActionType, classifyErrorCategory, detectRetry } from '@a0/eval-core';
import { LLM_API_KEY_ENV } from '../../cli/constants.js';
import { CodexTranslator } from './translator.js';

const translator = new CodexTranslator();

/** Model identifier written to RunRecord when Codex runner is used. */
export const CODEX_MODEL_ID = 'codex';

/** Default model for the Codex CLI runner. */
export const CODEX_DEFAULT_MODEL = 'gpt-5.4';

/**
 * Writes Codex config.toml to configure a custom proxy provider.
 */
function tomlEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function writeCodexConfig(
  codexHome: string,
  proxyBaseUrl: string,
  workspace: string,
): void {
  mkdirSync(codexHome, { recursive: true });
  // Resolve canonical path — on macOS /var is a symlink to /private/var.
  // Codex stores trusted project paths canonically, so we must match that.
  const resolvedWorkspace = tomlEscape(realpathSync(workspace));
  const safeBaseUrl = tomlEscape(proxyBaseUrl);
  const configToml = `model_provider = "llmproxy"
model_reasoning_effort = "medium"

[model_providers.llmproxy]
name = "LLM Proxy"
base_url = "${safeBaseUrl}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"

[projects."${resolvedWorkspace}"]
trust_level = "trusted"
`;
  writeFileSync(join(codexHome, 'config.toml'), configToml, 'utf-8');
}

export interface CodexRunOptions {
  /** Tool flags (e.g. ['mcp', 'skills']). */
  tools?: string[];
  /** Model to use. Defaults to CODEX_DEFAULT_MODEL. */
  model?: string;
}

/** Mutable state shared across exec + resume spawns within one task run. */
interface SpawnCtx {
  pending: Map<string, { name: string; args: Record<string, unknown>; startTime: number }>;
  turnNum: number;
  turnToolCount: number;
  turnStartTime: number;
  /** Thread/session ID captured from the first thread.started event. */
  threadId: string;
  /** Tool calls recorded in the most recent spawn (reset per spawn). */
  toolCallsInSpawn: number;
  /** Set to true once the master timeout fires — stops further spawns. */
  timedOut: boolean;
  /** Guards against double-counting when both standalone and item.completed events fire for the same callId. */
  recordedCallIds: Set<string>;
  /** Guards turnToolCount against being incremented twice when both function_call and item.completed[function_call] fire for the same callId. Reset each turn. */
  countedCallIds: Set<string>;
}

/** Builds a ToolCallRecord and appends it to record.toolCalls. */
function pushToolCall(
  record: RunRecord,
  rawName: string,
  rawArgs: Record<string, unknown>,
  output: string,
  isError: boolean,
  startTime: number,
  logExtra?: string,
): void {
  const mappedName = translator.mapName(rawName);
  const toolArgs = translator.normalizeArgs(rawName, rawArgs);
  const endTime = Date.now() / 1000;
  const elapsed = ((endTime - startTime) * 1000).toFixed(0);
  const preview = output.slice(0, 80).replace(/\n/g, ' ');

  if (isError) {
    logger.error(`  [Codex] ${mappedName} ✗ (${elapsed}ms)${logExtra ? ` ${logExtra}` : ''} ${preview}`);
  } else {
    logger.info(`  [Codex] ${mappedName} ✓ (${elapsed}ms)${preview ? ` → ${preview}` : ''}`);
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
}

/**
 * Spawns one `codex` process, parses its JSONL stdout into `record`, and resolves
 * when the process exits. Mutates `ctx` so turn counters carry over to resumes.
 */
function runCodexSpawn(
  args: string[],
  workspace: string,
  codexEnv: Record<string, string>,
  model: string,
  record: RunRecord,
  ctx: SpawnCtx,
  deadlineMs: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0 || ctx.timedOut) {
      resolve();
      return;
    }

    ctx.toolCallsInSpawn = 0;

    // stdin = 'ignore' passes /dev/null — Codex reads zero bytes and immediately
    // proceeds. This prevents Codex from blocking on the "Reading additional input
    // from stdin" startup prompt (exec help: "if stdin is piped and a prompt is
    // also provided, stdin is appended as a <stdin> block"). We pass the full
    // prompt as a CLI arg; no stdin block needed.
    const child = spawn('codex', args, { cwd: workspace, env: codexEnv, stdio: ['ignore', 'pipe', 'pipe'] });

    const spawnTimeout = setTimeout(() => {
      ctx.timedOut = true;
      record.providerErrors.push(`task timeout after ${CODEX_TASK_TIMEOUT_MS / 1000}s`);
      record.status = 'failure';
      logger.info('[Codex] ✗ Task timeout — killing');
      child.kill('SIGTERM');
    }, remaining);

    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          logger.warn(`[Codex] Non-JSON stdout: ${trimmed.slice(0, 120)}`);
          return;
        }

        const type = event.type as string;

        switch (type) {
          case 'thread.started':
            if (!ctx.threadId) {
              ctx.threadId = (event.thread_id as string) ?? '';
              record.sessionId = ctx.threadId || record.sessionId;
            }
            logger.info(`[Codex] Thread ${ctx.threadId}`);
            break;

          case 'turn.started':
            ctx.turnStartTime = Date.now() / 1000;
            ctx.turnToolCount = 0;
            ctx.countedCallIds.clear();
            break;

          case 'function_call': {
            const toolName = (event.name as string) ?? 'unknown';
            const callId = (event.call_id as string) ?? String(Date.now());
            let params: Record<string, unknown> = {};
            if (typeof event.arguments === 'string') {
              try {
                params = JSON.parse(event.arguments) as Record<string, unknown>;
              } catch {
                params = { input: event.arguments };
              }
            } else if (typeof event.arguments === 'object' && event.arguments !== null) {
              params = event.arguments as Record<string, unknown>;
            }
            ctx.pending.set(callId, { name: toolName, args: params, startTime: Date.now() / 1000 });
            if (!ctx.countedCallIds.has(callId)) {
              ctx.countedCallIds.add(callId);
              ctx.turnToolCount++;
              ctx.toolCallsInSpawn++;
            }
            break;
          }

          case 'function_call_output': {
            const callId = (event.call_id as string) ?? '';
            if (ctx.recordedCallIds.has(callId)) break;
            ctx.recordedCallIds.add(callId);
            const pend = ctx.pending.get(callId);
            if (pend) ctx.pending.delete(callId);

            const output = (event.output as string) ?? '';
            const rawName = pend?.name ?? 'unknown';
            const isError = output.startsWith('Error:') || output.startsWith('error:');
            pushToolCall(record, rawName, pend?.args ?? {}, output, isError, pend?.startTime ?? Date.now() / 1000);
            break;
          }

          case 'message': {
            const role = event.role as string | undefined;
            const content = (event.content as string) ?? '';
            if (role === 'assistant' && content) {
              record.finalSummary = content;
            }
            break;
          }

          case 'item.started': {
            const item = event.item as Record<string, unknown> | undefined;
            if (!item) break;
            if ((item.type as string) === 'command_execution') {
              const itemId = (item.id as string) ?? String(Date.now());
              const cmd = (item.command as string) ?? '';
              ctx.pending.set(itemId, {
                name: 'command_execution',
                args: { command: cmd },
                startTime: Date.now() / 1000,
              });
              ctx.turnToolCount++;
              ctx.toolCallsInSpawn++;
              logger.info(`  [Codex] command_execution started (${itemId}): ${cmd.slice(0, 80)}`);
            }
            break;
          }

          case 'item.completed': {
            const item = event.item as Record<string, unknown> | undefined;
            if (!item) break;

            const itemType = item.type as string;
            const itemId = (item.id as string) ?? '';

            if (itemType === 'agent_message') {
              const text = (item.text as string) ?? '';
              if (text) record.finalSummary = text;
            } else if (itemType === 'command_execution') {
              const pend = ctx.pending.get(itemId);
              if (pend) ctx.pending.delete(itemId);

              const command = (item.command as string) ?? (pend?.args.command as string) ?? '';
              const output = (item.aggregated_output as string) ?? '';
              const exitCode = (item.exit_code as number | null | undefined) ?? null;
              const isError = exitCode !== null && exitCode !== 0;
              pushToolCall(record, 'command_execution', { command }, output, isError, pend?.startTime ?? Date.now() / 1000, isError ? `exit=${exitCode}` : undefined);
            } else if (itemType === 'function_call') {
              const toolName = (item.name as string) ?? 'unknown';
              const callId = (item.call_id as string) ?? itemId;
              let params: Record<string, unknown> = {};
              const rawArgs = item.arguments;
              if (typeof rawArgs === 'string') {
                try {
                  params = JSON.parse(rawArgs) as Record<string, unknown>;
                } catch {
                  params = { input: rawArgs };
                }
              } else if (typeof rawArgs === 'object' && rawArgs !== null) {
                params = rawArgs as Record<string, unknown>;
              }
              ctx.pending.set(callId, { name: toolName, args: params, startTime: Date.now() / 1000 });
              if (!ctx.countedCallIds.has(callId)) {
                ctx.countedCallIds.add(callId);
                ctx.turnToolCount++;
                ctx.toolCallsInSpawn++;
              }
              logger.info(`  [Codex] function_call: ${toolName} (${callId})`);
            } else if (itemType === 'function_call_output') {
              const callId = (item.call_id as string) ?? '';
              const pend = ctx.pending.get(callId);
              ctx.pending.delete(callId); // clean up even if already recorded
              if (ctx.recordedCallIds.has(callId)) break;
              ctx.recordedCallIds.add(callId);

              const output = (item.output as string) ?? '';
              const rawName = pend?.name ?? 'unknown';
              const isError = output.startsWith('Error:') || output.startsWith('error:');
              pushToolCall(record, rawName, pend?.args ?? {}, output, isError, pend?.startTime ?? Date.now() / 1000);
            }
            break;
          }

          case 'turn.completed': {
            ctx.turnNum++;
            const turnEndTime = Date.now() / 1000;

            const usage = (event.usage ?? {}) as Record<string, unknown>;
            const inputTokens = (usage.input_tokens as number) ?? 0;
            const outputTokens = (usage.output_tokens as number) ?? 0;

            record.inputTokens += inputTokens;
            record.outputTokens += outputTokens;

            const turnCost = estimateCost(model, inputTokens, outputTokens);
            record.costUsd += turnCost;

            const tm: TurnMetric = {
              turn: ctx.turnNum,
              inputTokens,
              outputTokens,
              llmLatency: Math.max(0, turnEndTime - ctx.turnStartTime),
              finishReason: ctx.turnToolCount > 0 ? 'tool_calls' : 'stop',
              toolCallCount: ctx.turnToolCount,
              costUsd: turnCost,
            };
            record.turnMetrics.push(tm);

            logger.info(
              `[Codex] Turn ${ctx.turnNum}: ${inputTokens}in/${outputTokens}out tokens, ` +
                `${ctx.turnToolCount} tool(s), cost=$${turnCost.toFixed(4)}`,
            );
            ctx.turnStartTime = turnEndTime;
            ctx.turnToolCount = 0;

            if (!ctx.timedOut && ctx.turnNum >= MAX_TURNS) {
              ctx.timedOut = true;
              record.providerErrors.push(`turn limit: stopped after ${MAX_TURNS} turns`);
              record.status = 'failure';
              logger.info(`[Codex] ✗ Turn limit reached (${MAX_TURNS}) — killing`);
              child.kill('SIGTERM');
            }
            break;
          }

          case 'turn.failed': {
            const err = (event.error ?? {}) as Record<string, unknown>;
            const msg = (err.message as string) ?? 'turn failed';
            record.providerErrors.push(msg);
            logger.error(`[Codex] Turn failed: ${msg}`);
            break;
          }

          case 'error': {
            const msg = (event.message as string) ?? 'unknown error';
            record.providerErrors.push(msg);
            logger.error(`[Codex] Error: ${msg}`);
            break;
          }

          default:
            logger.info(`[Codex] Unhandled event type="${type}": ${JSON.stringify(event).slice(0, 200)}`);
            break;
        }
      });
    }

    child.on('close', (code) => {
      clearTimeout(spawnTimeout);

      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
      if (stderr) {
        logger.info(`[Codex] stderr: ${stderr.slice(0, 500)}`);
      }

      // Drain tool calls that started but never received an output event.
      for (const [, pend] of ctx.pending) {
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
      ctx.pending.clear();

      if (code !== 0 && record.status !== 'failure') {
        if (record.toolCalls.length === 0 && !record.finalSummary) {
          const msg = `codex exited with code ${code ?? 1}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`;
          record.providerErrors.push(msg);
          record.status = 'failure';
          logger.error(`[Codex] ✗ ${msg}`);
        }
      }

      resolve();
    });

    child.on('error', (err) => {
      clearTimeout(spawnTimeout);
      record.providerErrors.push(`spawn error: ${err.message}`);
      record.status = 'failure';
      logger.error(`[Codex] ✗ Spawn error: ${err.message}`);
      resolve();
    });
  });
}

/**
 * How many times to resume with a nudge if the model returns a text-only
 * planning message instead of calling tools on the first exec.
 * GPT models may return a planning message before calling tools.
 */
const MAX_RESUME_NUDGES = 3;

/**
 * Runs a Codex CLI agent against an eval and returns a RunRecord compatible
 * with the scorer and serialisers used by the standard agent pipeline.
 *
 * Handles the reasoning-model pattern: when the model returns a text-only
 * planning message, we use `codex exec resume <session-id>` with a nudge
 * prompt to continue the session so the agent loop proceeds to tools.
 */
export async function runCodexAgent(
  evalDef: Pick<EvalDefinition, 'id' | 'userPrompt'>,
  workspace: string,
  opts: CodexRunOptions = {},
): Promise<RunRecord> {
  const { tools = [], model = CODEX_DEFAULT_MODEL } = opts;

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

  logger.info(`\n[Codex] Starting task: ${evalDef.id}`);
  logger.info(`[Codex] Workspace: ${workspace}`);
  logger.info(`[Codex] Model: ${model}`);

  // Route through the configured proxy.
  // CODEX_HOME must NOT be under /tmp — Codex refuses to create helper binaries there.
  // Keep it under $HOME so the Codex binary cache is reusable across runs, but use a
  // per-session subdirectory so parallel runs don't share session state or sqlite files.
  // Critically: keep CODEX_HOME *outside* the workspace so Codex's internal files
  // (sqlite, plugins, sessions, ~200 files) don't pollute the grader corpus.
  const proxyBaseUrl = getAgentProxyBaseUrl('codex');
  const codexHome = join(homedir(), '.codex-eval', record.sessionId);
  mkdirSync(codexHome, { recursive: true });

  const normalizedBaseUrl = proxyBaseUrl.replace(/\/+$/, '');
  const codexApiUrl = normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
  writeCodexConfig(codexHome, codexApiUrl, workspace);
  logger.info(`[Codex] Proxy: ${proxyBaseUrl}`);
  logger.info(`[Codex] CODEX_HOME: ${codexHome}`);

  // Build environment — inherit from process, injecting the API key for the proxy.
  const codexEnv: Record<string, string> = { ...filteredEnv() };
  if (process.env[LLM_API_KEY_ENV]) {
    codexEnv.OPENAI_API_KEY = process.env[LLM_API_KEY_ENV]!;
  } else {
    logger.warn(`[Codex] ${LLM_API_KEY_ENV} not set — requests will fail.`);
  }
  codexEnv.CODEX_HOME = codexHome;

  // skills are injected into the workspace by CodexRunner.prepareSkills().
  // MCP tools are not yet supported by the Codex runner.
  if (tools.includes('mcp')) {
    logger.warn('[Codex] MCP tools requested but not yet supported — MCP will be skipped for this run.');
  }

  const ctx: SpawnCtx = {
    pending: new Map(),
    turnNum: 0,
    turnToolCount: 0,
    turnStartTime: record.startTime,
    threadId: '',
    toolCallsInSpawn: 0,
    timedOut: false,
    recordedCallIds: new Set(),
    countedCallIds: new Set(),
  };

  // Shared deadline across all spawns (exec + resume nudges).
  const deadlineMs = Date.now() + CODEX_TASK_TIMEOUT_MS;

  // Common flags for both exec and resume.
  const commonFlags = [
    '--skip-git-repo-check',
    '--json',
    '--dangerously-bypass-approvals-and-sandbox',
    '--model',
    model,
  ];

  // Initial exec. We prepend a short action directive because reasoning models
  // often output a planning message before calling tools.
  // The directive nudges the model to act immediately without preamble.
  const execArgs = [
    'exec',
    `Start immediately — use shell commands and file writes to complete the task. Do not explain your plan first.\n\n${evalDef.userPrompt}`,
    ...commonFlags,
  ];
  try {
    await runCodexSpawn(execArgs, workspace, codexEnv, model, record, ctx, deadlineMs);

    // Resume loop: if the model returned a text-only planning message (0 tools),
    // resume the session with a nudge. This is the standard way to handle
    // reasoning-model planning turns in Codex's non-interactive exec mode.
    for (let nudge = 0; nudge < MAX_RESUME_NUDGES; nudge++) {
      if (ctx.timedOut || ctx.toolCallsInSpawn > 0 || !ctx.threadId) break;

      logger.info(
        `[Codex] Text-only turn — resuming with nudge ${nudge + 1}/${MAX_RESUME_NUDGES} (thread=${ctx.threadId})`,
      );
      const resumeArgs = [
        'exec',
        'resume',
        ctx.threadId,
        'Go ahead and implement now. Run the necessary shell commands and write the files directly.',
        ...commonFlags,
      ];
      await runCodexSpawn(resumeArgs, workspace, codexEnv, model, record, ctx, deadlineMs);
    }
  } finally {
    await rm(codexHome, { recursive: true, force: true }).catch(() => {});
  }

  // Finalise the record.
  record.endTime = Date.now() / 1000;
  if (record.status === 'running') {
    record.status = record.toolCalls.length > 0 || record.finalSummary ? 'success' : 'failure';
    if (record.status === 'failure') {
      record.providerErrors.push('no output received');
    }
  }

  logger.info(
    `[Codex] Done — status=${record.status} turns=${ctx.turnNum} ` +
      `tools=${record.toolCalls.length} cost=$${record.costUsd.toFixed(4)}`,
  );
  return record;
}
