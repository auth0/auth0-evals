/**
 * DeepSeek agent runner.
 *
 * Drives DeepSeek through the `@openai/codex-sdk` `thread.runStreamed()` API and
 * maps its typed event stream into a RunRecord. DeepSeek exposes an OpenAI-compatible
 * Responses API, so the Codex SDK works unchanged — only the proxy base URL differs.
 *
 * Authentication: routed through the configured proxy using the LLM API key.
 * Configure `agents.deepseek.proxy.baseUrl` in eval.config.js (falls back to
 * `proxy.baseUrl`) to point at a proxy or directly at api.deepseek.com.
 *
 * Event stream (ThreadEvent): thread.started, turn.started/completed/failed,
 * item.started/updated/completed (whose items include command_execution,
 * file_change, mcp_tool_call, agent_message, web_search, error), and error.
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Codex } from '@openai/codex-sdk';
import type { Thread, ThreadEvent, ThreadItem, ThreadOptions } from '@openai/codex-sdk';
import type { RunRecord, ToolCallRecord, TurnMetric, EvalDefinition, MCPServerConfig } from '@a0/evals-core';
import {
  CODEX_TASK_TIMEOUT_MS,
  MAX_TURNS,
  getAgentProxyBaseUrl,
  getFrameworkConfig,
  estimateCost,
  logger,
  filteredEnv,
  readWorkspaceFile,
  makeSessionId,
  mintMcpToken,
  mcpBearerTokenEnvVar,
} from '@a0/evals-core';
import { classifyActionType, classifyErrorCategory, detectRetry } from '@a0/evals-core';
import { LLM_API_KEY_ENV } from '../../cli/constants.js';
import { CodexTranslator, detectReadOnlyFileRead } from '../codex/translator.js';

const translator = new CodexTranslator();

/** Model identifier written to RunRecord when DeepSeek runner is used. */
export const DEEPSEEK_MODEL_ID = 'deepseek';

/** Default model for the DeepSeek runner. */
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';

function tomlEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildMcpToml(
  servers: Record<string, MCPServerConfig>,
  bearerTokenEnvVars: Record<string, string> = {},
): string {
  let toml = '';
  for (const [name, server] of Object.entries(servers)) {
    const safeName = tomlEscape(name);
    if (server.type === 'http') {
      toml += `\n[mcp_servers."${safeName}"]\nurl = "${tomlEscape(server.url)}"\n`;
      const envVar = bearerTokenEnvVars[name];
      if (envVar) {
        toml += `bearer_token_env_var = "${tomlEscape(envVar)}"\n`;
      }
    } else {
      toml += `\n[mcp_servers."${safeName}"]\ncommand = "${tomlEscape(server.command)}"\n`;
      if (server.args && server.args.length > 0) {
        const argsToml = server.args.map((a) => `"${tomlEscape(a)}"`).join(', ');
        toml += `args = [${argsToml}]\n`;
      }
      if (server.env && Object.keys(server.env).length > 0) {
        const envKeys = Object.keys(server.env)
          .map((k) => `"${tomlEscape(k)}"`)
          .join(', ');
        toml += `env_vars = [${envKeys}]\n`;
      }
    }
  }
  return toml;
}

function writeDeepSeekConfig(
  codexHome: string,
  proxyBaseUrl: string,
  workspace: string,
  mcpServers: Record<string, MCPServerConfig> = {},
  bearerTokenEnvVars: Record<string, string> = {},
): void {
  mkdirSync(codexHome, { recursive: true });
  const resolvedWorkspace = tomlEscape(realpathSync(workspace));
  const safeBaseUrl = tomlEscape(proxyBaseUrl);
  const configToml = `model_provider = "llmproxy"
model_reasoning_effort = "medium"

[model_providers.llmproxy]
name = "DeepSeek Proxy"
base_url = "${safeBaseUrl}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"

[projects."${resolvedWorkspace}"]
trust_level = "trusted"
${buildMcpToml(mcpServers, bearerTokenEnvVars)}`;
  writeFileSync(join(codexHome, 'config.toml'), configToml, 'utf-8');
}

export interface DeepSeekRunOptions {
  /** Tool flags (e.g. ['mcp', 'skills']). */
  tools?: string[];
  /** Model to use. Defaults to DEEPSEEK_DEFAULT_MODEL. */
  model?: string;
}

interface RunCtx {
  turnNum: number;
  turnToolCount: number;
  turnStartTime: number;
  threadId: string;
  toolCallsInTurn: number;
  timedOut: boolean;
  workspace: string;
  itemStartTimes: Map<string, number>;
}

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
    logger.error(`  [DeepSeek] ${mappedName} ✗ (${elapsed}ms)${logExtra ? ` ${logExtra}` : ''} ${preview}`);
  } else {
    logger.info(`  [DeepSeek] ${mappedName} ✓ (${elapsed}ms)${preview ? ` → ${preview}` : ''}`);
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

function handleItem(item: ThreadItem, record: RunRecord, ctx: RunCtx, now: number): void {
  switch (item.type) {
    case 'agent_message': {
      if (item.text) record.finalSummary = item.text;
      break;
    }

    case 'command_execution': {
      const command = item.command ?? '';
      const isError = typeof item.exit_code === 'number' && item.exit_code !== 0;
      ctx.turnToolCount++;
      ctx.toolCallsInTurn++;

      const readPath = !isError ? detectReadOnlyFileRead(command) : null;
      if (readPath) {
        pushToolCall(record, 'read_file', { path: readPath }, item.aggregated_output ?? '', false, now);
      } else {
        pushToolCall(
          record,
          'command_execution',
          { command },
          item.aggregated_output ?? '',
          isError,
          now,
          isError ? `exit=${item.exit_code}` : undefined,
        );
      }
      break;
    }

    case 'file_change': {
      const isError = item.status === 'failed';
      for (const change of item.changes) {
        const rawName = change.kind === 'delete' ? 'delete_file' : 'write_file';
        const content = !isError && change.kind !== 'delete' ? readWorkspaceFile(ctx.workspace, change.path) : '';
        ctx.turnToolCount++;
        ctx.toolCallsInTurn++;
        pushToolCall(record, rawName, { path: change.path, content }, '', isError, now);
      }
      break;
    }

    case 'mcp_tool_call': {
      const mcpName = `mcp__${item.server}__${item.tool}`;
      const args =
        typeof item.arguments === 'object' && item.arguments !== null
          ? (item.arguments as Record<string, unknown>)
          : {};
      const isError = !!item.error || item.status === 'failed';
      let output = '';
      if (item.error) {
        output = `Error: ${item.error.message}`;
      } else if (item.result !== null && item.result !== undefined) {
        output = typeof item.result === 'string' ? item.result : JSON.stringify(item.result);
      }
      ctx.turnToolCount++;
      ctx.toolCallsInTurn++;
      pushToolCall(record, mcpName, args, output, isError, now);
      break;
    }

    case 'web_search': {
      ctx.turnToolCount++;
      ctx.toolCallsInTurn++;
      pushToolCall(record, 'web_search', { query: item.query }, '', false, now);
      break;
    }

    case 'error': {
      record.providerErrors.push(item.message);
      logger.error(`[DeepSeek] Item error: ${item.message}`);
      break;
    }

    default:
      break;
  }
}

function handleEvent(
  ev: ThreadEvent,
  record: RunRecord,
  ctx: RunCtx,
  model: string,
  controller: AbortController,
): void {
  switch (ev.type) {
    case 'thread.started':
      if (!ctx.threadId) {
        ctx.threadId = ev.thread_id ?? '';
        record.sessionId = ctx.threadId || record.sessionId;
      }
      logger.info(`[DeepSeek] Thread ${ctx.threadId}`);
      break;

    case 'turn.started':
      ctx.turnStartTime = Date.now() / 1000;
      ctx.turnToolCount = 0;
      break;

    case 'item.started':
      if (ev.item.id) ctx.itemStartTimes.set(ev.item.id, Date.now() / 1000);
      break;

    case 'item.completed': {
      const startTime = (ev.item.id && ctx.itemStartTimes.get(ev.item.id)) || Date.now() / 1000;
      if (ev.item.id) ctx.itemStartTimes.delete(ev.item.id);
      handleItem(ev.item, record, ctx, startTime);
      break;
    }

    case 'turn.completed': {
      ctx.turnNum++;
      const turnEndTime = Date.now() / 1000;
      const inputTokens = ev.usage?.input_tokens ?? 0;
      const outputTokens = ev.usage?.output_tokens ?? 0;

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
        `[DeepSeek] Turn ${ctx.turnNum}: ${inputTokens}in/${outputTokens}out tokens, ` +
          `${ctx.turnToolCount} tool(s), cost=$${turnCost.toFixed(4)}`,
      );
      ctx.turnStartTime = turnEndTime;
      ctx.turnToolCount = 0;

      if (!ctx.timedOut && ctx.turnNum >= MAX_TURNS) {
        ctx.timedOut = true;
        record.providerErrors.push(`turn limit: stopped after ${MAX_TURNS} turns`);
        record.status = 'failure';
        logger.info(`[DeepSeek] ✗ Turn limit reached (${MAX_TURNS}) — aborting`);
        controller.abort();
      }
      break;
    }

    case 'turn.failed':
      record.providerErrors.push(ev.error?.message ?? 'turn failed');
      logger.error(`[DeepSeek] Turn failed: ${ev.error?.message ?? 'turn failed'}`);
      break;

    case 'error':
      record.providerErrors.push(ev.message ?? 'unknown error');
      logger.error(`[DeepSeek] Error: ${ev.message}`);
      break;

    default:
      break;
  }
}

async function runTurn(
  thread: Thread,
  input: string,
  controller: AbortController,
  record: RunRecord,
  ctx: RunCtx,
  model: string,
): Promise<void> {
  if (ctx.timedOut || controller.signal.aborted) return;
  ctx.toolCallsInTurn = 0;

  try {
    const { events } = await thread.runStreamed(input, { signal: controller.signal });
    for await (const ev of events) {
      handleEvent(ev, record, ctx, model, controller);
    }
  } catch (err) {
    if (controller.signal.aborted) {
      logger.info('[DeepSeek] Turn aborted');
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    record.providerErrors.push(`deepseek error: ${msg}`);
    if (record.toolCalls.length === 0 && !record.finalSummary) {
      record.status = 'failure';
    }
    logger.error(`[DeepSeek] ✗ ${msg}`);
  }
}

const MAX_RESUME_NUDGES = 3;

export async function runDeepSeekAgent(
  evalDef: Pick<EvalDefinition, 'id' | 'userPrompt'>,
  workspace: string,
  opts: DeepSeekRunOptions = {},
): Promise<RunRecord> {
  const { tools = [], model = DEEPSEEK_DEFAULT_MODEL } = opts;

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

  logger.info(`\n[DeepSeek] Starting task: ${evalDef.id}`);
  logger.info(`[DeepSeek] Workspace: ${workspace}`);
  logger.info(`[DeepSeek] Model: ${model}`);

  const proxyBaseUrl = getAgentProxyBaseUrl('deepseek');
  const codexHome = join(homedir(), '.codex-eval-deepseek', record.sessionId);
  mkdirSync(codexHome, { recursive: true });

  const configuredServers: Record<string, MCPServerConfig> = tools.includes('mcp')
    ? getFrameworkConfig().mcp.servers
    : {};

  const mcpServers: Record<string, MCPServerConfig> = {};
  const bearerTokenEnvVars: Record<string, string> = {};
  const bearerTokens: Record<string, string> = {};
  for (const [name, server] of Object.entries(configuredServers)) {
    if (server.type === 'http' && server.auth) {
      const token = await mintMcpToken(server.auth);
      if (!token) {
        logger.warn(`[DeepSeek] MCP server '${name}' skipped — token mint failed or creds missing`);
        continue;
      }
      const envVar = mcpBearerTokenEnvVar(name);
      if (bearerTokens[envVar] !== undefined) {
        logger.warn(
          `[DeepSeek] MCP server '${name}' skipped — env var ${envVar} already used by another server (name collision)`,
        );
        continue;
      }
      bearerTokenEnvVars[name] = envVar;
      bearerTokens[envVar] = token;
    }
    mcpServers[name] = server;
  }

  const normalizedBaseUrl = proxyBaseUrl.replace(/\/+$/, '');
  const codexApiUrl = normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
  writeDeepSeekConfig(codexHome, codexApiUrl, workspace, mcpServers, bearerTokenEnvVars);
  logger.info(`[DeepSeek] Proxy: ${proxyBaseUrl}`);
  logger.info(`[DeepSeek] CODEX_HOME: ${codexHome}`);
  if (Object.keys(mcpServers).length > 0) {
    logger.info(`[DeepSeek] MCP servers: ${Object.keys(mcpServers).join(', ')}`);
  } else if (tools.includes('mcp')) {
    logger.warn(`[DeepSeek] --tools mcp requested but no MCP servers are available`);
  }

  const codexEnv: Record<string, string> = { ...filteredEnv() };
  if (process.env[LLM_API_KEY_ENV]) {
    codexEnv.OPENAI_API_KEY = process.env[LLM_API_KEY_ENV]!;
  } else {
    logger.warn(`[DeepSeek] ${LLM_API_KEY_ENV} not set — requests will fail.`);
  }
  codexEnv.CODEX_HOME = codexHome;

  for (const server of Object.values(mcpServers)) {
    if (server.type === 'stdio' && server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        codexEnv[key] = value;
      }
    }
  }

  for (const [key, value] of Object.entries(bearerTokens)) {
    codexEnv[key] = value;
  }

  const ctx: RunCtx = {
    turnNum: 0,
    turnToolCount: 0,
    turnStartTime: record.startTime,
    threadId: '',
    toolCallsInTurn: 0,
    timedOut: false,
    workspace,
    itemStartTimes: new Map(),
  };

  const codex = new Codex({ env: codexEnv });

  const threadOptions: ThreadOptions = {
    model,
    workingDirectory: workspace,
    sandboxMode: 'danger-full-access',
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
  };

  const controller = new AbortController();
  const deadline = setTimeout(() => {
    ctx.timedOut = true;
    record.providerErrors.push(`task timeout after ${CODEX_TASK_TIMEOUT_MS / 1000}s`);
    record.status = 'failure';
    logger.info('[DeepSeek] ✗ Task timeout — aborting');
    controller.abort();
  }, CODEX_TASK_TIMEOUT_MS);

  const execPrompt = `Start immediately — use shell commands and file writes to complete the task. Do not explain your plan first.\n\n${evalDef.userPrompt}`;

  try {
    const thread = codex.startThread(threadOptions);
    await runTurn(thread, execPrompt, controller, record, ctx, model);

    for (let nudge = 0; nudge < MAX_RESUME_NUDGES; nudge++) {
      if (ctx.timedOut || ctx.toolCallsInTurn > 0 || !ctx.threadId) break;

      logger.info(
        `[DeepSeek] Text-only turn — resuming with nudge ${nudge + 1}/${MAX_RESUME_NUDGES} (thread=${ctx.threadId})`,
      );
      const resumeThread = codex.resumeThread(ctx.threadId, threadOptions);
      await runTurn(
        resumeThread,
        'Go ahead and implement now. Run the necessary shell commands and write the files directly.',
        controller,
        record,
        ctx,
        model,
      );
    }
  } finally {
    clearTimeout(deadline);
    await rm(codexHome, { recursive: true, force: true }).catch(() => {});
  }

  record.endTime = Date.now() / 1000;
  if (record.status === 'running') {
    record.status = record.toolCalls.length > 0 || record.finalSummary ? 'success' : 'failure';
    if (record.status === 'failure') {
      record.providerErrors.push('no output received');
    }
  }

  logger.info(
    `[DeepSeek] Done — status=${record.status} turns=${ctx.turnNum} ` +
      `tools=${record.toolCalls.length} cost=$${record.costUsd.toFixed(4)}`,
  );
  return record;
}
