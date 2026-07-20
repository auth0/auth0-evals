/**
 * Codex agent runner.
 *
 * Drives Codex through the `@openai/codex-sdk` `thread.runStreamed()` API and
 * maps its typed event stream into a RunRecord. The SDK internally spawns the
 * `codex` binary with the env we provide, so it still reads `$CODEX_HOME/config.toml`
 * — meaning our proxy/auth/MCP config and corpus isolation are unchanged.
 *
 * Authentication: routed through the configured proxy using the LLM API key —
 * the same token used by all other runners. Codex is configured with
 * wire_api = "responses" so it uses the REST-based Responses API (not websockets),
 * which the proxy supports natively. We deliberately do NOT pass baseUrl/apiKey
 * through CodexOptions; those map to a different auth path (openai_base_url +
 * CODEX_API_KEY) that would conflict with the llmproxy provider block.
 *
 * Event stream (ThreadEvent): thread.started, turn.started/completed/failed,
 * item.started/updated/completed (whose items include command_execution,
 * file_change, mcp_tool_call, agent_message, web_search, error), and error.
 * Codex's apply_patch edits surface as structured `file_change` items, giving
 * per-file observability that raw `command_execution` parsing could not.
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
import { CodexTranslator, detectReadOnlyFileRead } from './translator.js';

const translator = new CodexTranslator();

/** Model identifier written to RunRecord when Codex runner is used. */
export const CODEX_MODEL_ID = 'codex';

/** Default model for the Codex CLI runner. */
export const CODEX_DEFAULT_MODEL = 'gpt-5.6-sol';

/**
 * Writes Codex config.toml to configure a custom proxy provider.
 */
function tomlEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Builds the `[mcp_servers.*]` TOML blocks.
 *
 * For HTTP servers with an entry in `bearerTokenEnvVars`, emits
 * `bearer_token_env_var = "<NAME>"` so Codex reads the Bearer token from that
 * env var at runtime. Codex rejects an inline `bearer_token` key, so the token
 * is never written to the config file — only the env-var name is.
 */
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

function writeCodexConfig(
  codexHome: string,
  proxyBaseUrl: string,
  workspace: string,
  mcpServers: Record<string, MCPServerConfig> = {},
  bearerTokenEnvVars: Record<string, string> = {},
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
${buildMcpToml(mcpServers, bearerTokenEnvVars)}`;
  writeFileSync(join(codexHome, 'config.toml'), configToml, 'utf-8');
}

export interface CodexRunOptions {
  /** Tool flags (e.g. ['mcp', 'skills']). */
  tools?: string[];
  /** Model to use. Defaults to CODEX_DEFAULT_MODEL. */
  model?: string;
}

/** Mutable state shared across the initial run + resume turns within one task. */
interface RunCtx {
  turnNum: number;
  turnToolCount: number;
  turnStartTime: number;
  /** Thread/session ID captured from the first thread.started event. */
  threadId: string;
  /** Tool calls recorded in the most recent turn (reset per turn invocation). */
  toolCallsInTurn: number;
  /** Set to true once the master timeout or turn limit fires — stops further turns. */
  timedOut: boolean;
  /** Absolute workspace root — used to read back content of patched files. */
  workspace: string;
  /**
   * Start timestamp (seconds) per item id, captured on `item.started` so the
   * ToolCallRecord reflects the real active duration (started → completed)
   * rather than a ~0s window measured entirely within `item.completed`.
   */
  itemStartTimes: Map<string, number>;
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

/** Records one tool-call ThreadItem into `record` and bumps turn counters. */
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

      // Codex reads files through the shell. Map an unambiguous single-file read
      // to read_file so duplicate-read detection works on par with file-native
      // runners; anything else stays a run_command.
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
      // Structured patch from Codex's apply_patch — one tool call per changed
      // path, giving per-file observability the scorer relies on. The SDK event
      // carries only path + kind (no content), so for a successful add/update we
      // read the patched file back from the workspace. This lets content-checking
      // graders (wroteFile with an `expected` arg) work on par with file-native
      // runners; reading the cumulative on-disk file also captures incremental
      // patches (e.g. env vars appended across several edits).
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
      logger.error(`[Codex] Item error: ${item.message}`);
      break;
    }

    // reasoning, todo_list — not tool calls; ignored for scoring.
    default:
      break;
  }
}

/**
 * Maps one SDK ThreadEvent into `record`. Aborts via `controller` when the turn
 * limit is reached. Mutates `ctx` so counters carry across the initial run + resumes.
 */
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
      logger.info(`[Codex] Thread ${ctx.threadId}`);
      break;

    case 'turn.started':
      ctx.turnStartTime = Date.now() / 1000;
      ctx.turnToolCount = 0;
      break;

    case 'item.started':
      // Record when the item began so item.completed can compute a real
      // active duration. Only tool-call items carry an id we care about.
      if (ev.item.id) ctx.itemStartTimes.set(ev.item.id, Date.now() / 1000);
      break;

    case 'item.completed': {
      // Prefer the start time captured on item.started; fall back to now for
      // items whose start we never saw (keeps duration non-negative).
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
        `[Codex] Turn ${ctx.turnNum}: ${inputTokens}in/${outputTokens}out tokens, ` +
          `${ctx.turnToolCount} tool(s), cost=$${turnCost.toFixed(4)}`,
      );
      ctx.turnStartTime = turnEndTime;
      ctx.turnToolCount = 0;

      if (!ctx.timedOut && ctx.turnNum >= MAX_TURNS) {
        ctx.timedOut = true;
        record.providerErrors.push(`turn limit: stopped after ${MAX_TURNS} turns`);
        record.status = 'failure';
        logger.info(`[Codex] ✗ Turn limit reached (${MAX_TURNS}) — aborting`);
        controller.abort();
      }
      break;
    }

    case 'turn.failed':
      record.providerErrors.push(ev.error?.message ?? 'turn failed');
      logger.error(`[Codex] Turn failed: ${ev.error?.message ?? 'turn failed'}`);
      break;

    case 'error':
      record.providerErrors.push(ev.message ?? 'unknown error');
      logger.error(`[Codex] Error: ${ev.message}`);
      break;

    default:
      break;
  }
}

/**
 * Runs one turn via `thread.runStreamed`, consuming its event stream into `record`.
 * The SDK generator throws on non-zero exit / abort; an abort is expected (timeout
 * or turn limit, already recorded), any other throw becomes a provider error.
 */
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
      // Timeout or turn-limit abort — the providerError + status were already set.
      logger.info('[Codex] Turn aborted');
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    record.providerErrors.push(`codex error: ${msg}`);
    if (record.toolCalls.length === 0 && !record.finalSummary) {
      record.status = 'failure';
    }
    logger.error(`[Codex] ✗ ${msg}`);
  }
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

  // Resolve MCP servers from framework config when --tools mcp is requested.
  const configuredServers: Record<string, MCPServerConfig> = tools.includes('mcp')
    ? getFrameworkConfig().mcp.servers
    : {};

  // Mint a Bearer token per HTTP server that declares an `auth` block. The token
  // is passed to Codex via an env var (referenced by `bearer_token_env_var` in
  // config.toml) — Codex rejects an inline `bearer_token`, so the secret never
  // touches the config file. Minting per job avoids reusing an expired token on
  // a long matrix run. A failed mint drops the server rather than registering it
  // unauthenticated, so a misconfigured run looks like "MCP wasn't available".
  const mcpServers: Record<string, MCPServerConfig> = {};
  const bearerTokenEnvVars: Record<string, string> = {};
  const bearerTokens: Record<string, string> = {};
  for (const [name, server] of Object.entries(configuredServers)) {
    if (server.type === 'http' && server.auth) {
      const token = await mintMcpToken(server.auth);
      if (!token) {
        logger.warn(`[Codex] MCP server '${name}' skipped — token mint failed or creds missing`);
        continue;
      }
      const envVar = mcpBearerTokenEnvVar(name);
      // Guard against two server names normalizing to the same env var (e.g.
      // `auth0-hosted` and `auth0.hosted`), which would silently clobber the
      // first server's token. Hand-authored configs don't hit this today, but
      // fail loudly rather than leave a confusing future debugging session.
      if (bearerTokens[envVar] !== undefined) {
        logger.warn(
          `[Codex] MCP server '${name}' skipped — env var ${envVar} already used by another server (name collision)`,
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
  writeCodexConfig(codexHome, codexApiUrl, workspace, mcpServers, bearerTokenEnvVars);
  logger.info(`[Codex] Proxy: ${proxyBaseUrl}`);
  logger.info(`[Codex] CODEX_HOME: ${codexHome}`);
  if (Object.keys(mcpServers).length > 0) {
    logger.info(`[Codex] MCP servers: ${Object.keys(mcpServers).join(', ')}`);
  } else if (tools.includes('mcp')) {
    // MCP was requested but no server became available (all mints failed or
    // none configured). Log it so an all-fail run doesn't read identically to
    // "MCP was never requested."
    logger.warn(`[Codex] --tools mcp requested but no MCP servers are available`);
  }

  // Build environment — inherit from process, injecting the API key for the proxy.
  const codexEnv: Record<string, string> = { ...filteredEnv() };
  if (process.env[LLM_API_KEY_ENV]) {
    codexEnv.OPENAI_API_KEY = process.env[LLM_API_KEY_ENV]!;
  } else {
    logger.warn(`[Codex] ${LLM_API_KEY_ENV} not set — requests will fail.`);
  }
  codexEnv.CODEX_HOME = codexHome;

  // Inject env vars declared by stdio MCP servers so Codex can pass them to server processes.
  for (const server of Object.values(mcpServers)) {
    if (server.type === 'stdio' && server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        codexEnv[key] = value;
      }
    }
  }

  // Inject minted Bearer tokens so Codex can resolve each authed server's
  // `bearer_token_env_var` reference at runtime.
  for (const [key, value] of Object.entries(bearerTokens)) {
    codexEnv[key] = value;
  }

  // Skills are injected into the workspace by CodexRunner.prepareSkills().

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

  // The SDK spawns the `codex` binary with this env, so it reads
  // $CODEX_HOME/config.toml for proxy/auth/MCP — same wiring as before.
  const codex = new Codex({ env: codexEnv });

  // sandboxMode + approvalPolicy replace the CLI's --dangerously-bypass-approvals-and-sandbox.
  const threadOptions: ThreadOptions = {
    model,
    workingDirectory: workspace,
    sandboxMode: 'danger-full-access',
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
  };

  // Master deadline shared across the initial run + resume nudges. Aborting the
  // signal makes the in-flight runStreamed generator throw, which runTurn catches.
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    ctx.timedOut = true;
    record.providerErrors.push(`task timeout after ${CODEX_TASK_TIMEOUT_MS / 1000}s`);
    record.status = 'failure';
    logger.info('[Codex] ✗ Task timeout — aborting');
    controller.abort();
  }, CODEX_TASK_TIMEOUT_MS);

  // Prepend a short action directive because reasoning models often output a
  // planning message before calling tools.
  const execPrompt = `Start immediately — use shell commands and file writes to complete the task. Do not explain your plan first.\n\n${evalDef.userPrompt}`;

  try {
    const thread = codex.startThread(threadOptions);
    await runTurn(thread, execPrompt, controller, record, ctx, model);

    // Resume loop: if the model returned a text-only planning message (0 tools),
    // resume the session with a nudge. This is the standard way to handle
    // reasoning-model planning turns in Codex's non-interactive mode.
    for (let nudge = 0; nudge < MAX_RESUME_NUDGES; nudge++) {
      if (ctx.timedOut || ctx.toolCallsInTurn > 0 || !ctx.threadId) break;

      logger.info(
        `[Codex] Text-only turn — resuming with nudge ${nudge + 1}/${MAX_RESUME_NUDGES} (thread=${ctx.threadId})`,
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
