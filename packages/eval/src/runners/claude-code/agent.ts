/**
 * Claude Code agent runner using the Claude Agent SDK.
 *
 * Uses the `query()` function from `@anthropic-ai/claude-agent-sdk` to run
 * Claude Code programmatically, replacing the previous subprocess-based approach.
 *
 * The agent system prompt is written to CLAUDE.md in the workspace so Claude Code picks it
 * up as persistent context. The user prompt is passed directly via `query()`.
 *
 * Tool names are mapped via ClaudeCodeTranslator (see translator.ts).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { RunRecord, ToolCallRecord, TurnMetric, FinishReason, EvalDefinition } from '@a0/eval-core';
import {
  CLAUDE_CODE_TASK_TIMEOUT_MS,
  MAX_TURNS,
  getLitellmModelMap,
  getLitellmModelReverseMap,
  getFrameworkConfig,
  getAgentProxyBaseUrl,
  estimateCost,
  logger,
  makeSessionId,
  filteredEnv,
} from '@a0/eval-core';
import { classifyActionType, classifyErrorCategory, detectRetry } from '@a0/eval-core';
import { LLM_API_KEY_ENV } from '../../cli/constants.js';
import { ClaudeCodeTranslator } from './translator.js';

// Module-level translator instance — all event processing uses this.
const translator = new ClaudeCodeTranslator();

// ── Model alias mapping ───────────────────────────────────────────────────────

/** Whether the runner should use Bedrock model IDs (via the ATKO /anthropic proxy endpoint). */
const USE_BEDROCK = process.env.CLAUDE_CODE_USE_BEDROCK_PROXY !== '0';

function getBedrockModelAliasMap(): Record<string, string> {
  return getFrameworkConfig().models.bedrock ?? {};
}

function getBedrockModelReverseMap(): Record<string, string> {
  return Object.fromEntries(Object.entries(getBedrockModelAliasMap()).map(([alias, full]) => [full, alias]));
}

function getAtkoKnownModels(): Set<string> {
  return new Set(Object.keys(getBedrockModelAliasMap()));
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Model identifier written to RunRecord when Claude Code runner is used. */
export const CLAUDE_CODE_MODEL_ID = 'claude-code';

/**
 * ATKO proxy base URL for the Claude CLI.
 * Reads from `agents.claude-code.proxy.baseUrl` in eval.config.js, falling back to
 * the top-level `proxy.baseUrl`.
 * The Agent SDK honours ANTHROPIC_BASE_URL, routing all requests through the proxy
 * instead of hitting api.anthropic.com directly.
 */
function getAnthropicProxyUrl(): string {
  return getAgentProxyBaseUrl('claude-code');
}

export interface ClaudeCodeRunOptions {
  /** Extra env vars forwarded to the SDK process. */
  env?: Record<string, string>;
  /**
   * Tool flags from the eval runner (e.g. `['mcp', 'skills']`).
   * When `'mcp'` is present, the Auth0 docs MCP server is registered with Claude Code
   * via `mcpServers` so it can call `search_auth0_docs` during the session.
   */
  tools?: string[];
  /**
   * Claude model identifier to pass via `model` option.
   * When omitted the SDK uses its own default model.
   * Use the Anthropic model ID format (e.g. `claude-sonnet-4-6-20251101`) or
   * an ATKO proxy alias (e.g. `claude-sonnet-4-6`) when routing through the proxy.
   */
  model?: string;
}

/**
 * Runs a Claude Code agent via the Agent SDK against an eval definition and returns a RunRecord
 * compatible with the scorer and serialisers used by the standard agent pipeline.
 *
 * @param evalDef  Eval definition supplying the task id and userPrompt.
 * @param workspace  Absolute path to the pre-seeded workspace directory.
 * @param opts  Optional runner configuration.
 */
export async function runClaudeCodeAgent(
  evalDef: Pick<EvalDefinition, 'id' | 'userPrompt'>,
  workspace: string,
  opts: ClaudeCodeRunOptions = {},
): Promise<RunRecord> {
  const { env = {}, tools = [], model } = opts;

  const record: RunRecord = {
    taskName: evalDef.id,
    model: CLAUDE_CODE_MODEL_ID,
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

  // In Bedrock mode, resolve short ATKO alias to the full Bedrock model ID
  // (e.g. claude-sonnet-4-6 → global.anthropic.claude-sonnet-4-6).
  // In LiteLLM mode, resolve via getLitellmModelMap() (adds underscore prefix).
  const resolvedModel = model
    ? USE_BEDROCK
      ? (getBedrockModelAliasMap()[model] ?? model)
      : (getLitellmModelMap()[model] ?? model)
    : undefined;

  // Build environment variables for the SDK process.
  // Route through the ATKO proxy's Anthropic pass-through endpoint.
  const proxyEnv: Record<string, string> = {
    ANTHROPIC_BASE_URL: getAnthropicProxyUrl(),
  };
  if (process.env[LLM_API_KEY_ENV]) {
    proxyEnv.ANTHROPIC_API_KEY = process.env[LLM_API_KEY_ENV]!;
  }

  // Claude Code CLI-specific env vars that must reach the subprocess.
  const claudeEnv: Record<string, string> = {};
  if (process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS) {
    claudeEnv.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS;
  }
  if (process.env.CLAUDE_CODE_USE_BEDROCK_PROXY) {
    claudeEnv.CLAUDE_CODE_USE_BEDROCK_PROXY = process.env.CLAUDE_CODE_USE_BEDROCK_PROXY;
  }

  // Build MCP server config when --tools mcp is requested.
  let mcpServers: Record<string, { type: 'http'; url: string }> | undefined;
  if (tools.includes('mcp')) {
    const configServers = getFrameworkConfig().mcp.servers;
    const httpServers: Record<string, { type: 'http'; url: string }> = {};
    for (const [name, server] of Object.entries(configServers)) {
      if (server.type === 'http') {
        httpServers[name] = { type: 'http' as const, url: server.url };
      }
    }
    if (Object.keys(httpServers).length > 0) mcpServers = httpServers;
  }

  logger.info(`\n[ClaudeCode] Starting task: ${evalDef.id}`);
  logger.info(`[ClaudeCode] Workspace: ${workspace}`);
  if (resolvedModel) {
    const modelLabel = resolvedModel !== model ? `${model} → ${resolvedModel}` : resolvedModel;
    logger.info(`[ClaudeCode] Model: ${modelLabel}`);
  }
  if (mcpServers) logger.info(`[ClaudeCode] MCP: ${Object.keys(mcpServers).join(', ')}`);
  logger.info(`[ClaudeCode] Proxy: ${getAnthropicProxyUrl()}`);

  // Set up abort controller for timeout
  const abortController = new AbortController();
  const taskTimeout = setTimeout(() => {
    record.providerErrors.push(`task timeout: killed after ${CLAUDE_CODE_TASK_TIMEOUT_MS / 1000}s`);
    record.status = 'failure';
    logger.info(`[ClaudeCode] ✗ Task timeout after ${CLAUDE_CODE_TASK_TIMEOUT_MS / 1000}s — aborting`);
    abortController.abort();
  }, CLAUDE_CODE_TASK_TIMEOUT_MS);

  // Pending tool_use blocks awaiting their tool_result: id → { name, input, startTime }
  const pending = new Map<string, { name: string; input: Record<string, unknown>; startTime: number }>();

  // Mutable turn state
  let turnNum = 0;
  let prevTurnEndTime = record.startTime;

  try {
    const q = query({
      prompt: evalDef.userPrompt,
      options: {
        cwd: workspace,
        pathToClaudeCodeExecutable: process.env.CLAUDE_CLI_PATH || undefined,
        model: resolvedModel,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        additionalDirectories: [workspace],
        abortController,
        env: { ...filteredEnv(), ...claudeEnv, ...proxyEnv, ...env },
        mcpServers,
        settingSources: ['project'],
      },
    });

    for await (const message of q) {
      const update = handleMessage(message, record, pending, turnNum, prevTurnEndTime);
      if (update) {
        turnNum = update.turnNum;
        prevTurnEndTime = update.prevTurnEndTime;
      }
      if (turnNum >= MAX_TURNS) {
        record.providerErrors.push(`turn limit: stopped after ${MAX_TURNS} turns`);
        record.status = 'failure';
        logger.info(`[ClaudeCode] ✗ Turn limit reached (${MAX_TURNS}) — aborting`);
        abortController.abort();
        break;
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Don't treat abort as unexpected error if we already set failure from timeout
    if (record.status !== 'failure') {
      record.status = 'failure';
      record.providerErrors.push(`sdk error: ${errMsg}`);
      logger.error(`[ClaudeCode] ✗ SDK error: ${errMsg}`);
    }
  } finally {
    clearTimeout(taskTimeout);
  }

  // Drain any tool_use blocks that never received a result
  const now = Date.now() / 1000;
  for (const [id, pend] of pending) {
    if (!translator.isInternalTool(pend.name)) {
      const mappedName = translator.mapName(pend.name);
      const normArgs = translator.normalizeArgs(pend.name, pend.input);
      const ctx_str = normArgs.path
        ? ` — path="${String(normArgs.path)}"`
        : normArgs.command
          ? ` — command="${String(normArgs.command).slice(0, 60)}"`
          : '';
      record.toolCalls.push({
        name: mappedName,
        args: normArgs,
        result: '<orphaned: result event never received>',
        startTime: pend.startTime,
        endTime: now,
        isDocLookup: translator.isDocLookup(pend.name),
        isInterruption: translator.isInterruption(pend.name),
        causedError: true,
        actionType: classifyActionType(mappedName, true),
        isRetry: detectRetry(record.toolCalls, mappedName, normArgs),
        recoveredFromError: false,
        errorCategory: 'unknown',
      });
      record.providerErrors.push(`orphaned tool_use: ${pend.name} (id=${id}) never received a result${ctx_str}`);
      logger.info(`[ClaudeCode] ⚠ Orphaned tool_use: ${pend.name} (id=${id})`);
    }
  }
  pending.clear();

  record.endTime = Date.now() / 1000;
  if (record.status === 'running') {
    if (turnNum === 0) {
      record.status = 'failure';
      record.providerErrors.push('no result event received from SDK — query may have exited unexpectedly');
      logger.error(`[ClaudeCode] ✗ No result event received and no turns completed`);
    } else {
      record.status = 'success';
    }
  }
  logger.info(
    `[ClaudeCode] Done — status=${record.status} turns=${turnNum} ` +
      `tools=${record.toolCalls.length} cost=$${record.costUsd.toFixed(4)}`,
  );

  return record;
}

// ── Message handler ──────────────────────────────────────────────────────────

export interface TurnStateUpdate {
  turnNum: number;
  prevTurnEndTime: number;
}

/**
 * Processes an SDK message and updates the RunRecord accordingly.
 * Returns a TurnStateUpdate when the turn state changes, null otherwise.
 */
export function handleMessage(
  message: SDKMessage,
  record: RunRecord,
  pending: Map<string, { name: string; input: Record<string, unknown>; startTime: number }>,
  turnNum: number,
  prevTurnEndTime: number,
): TurnStateUpdate | null {
  if (message.type === 'system') {
    const sys = message as SDKSystemMessage;
    if (sys.subtype !== 'init') return null;
    record.model = sys.model
      ? (getBedrockModelReverseMap()[sys.model] ??
        getLitellmModelReverseMap()[sys.model] ??
        (getAtkoKnownModels().has(sys.model) ? sys.model : `claude-code/${sys.model}`))
      : CLAUDE_CODE_MODEL_ID;
    record.sessionId = sys.session_id;
    logger.info(`[ClaudeCode] Session ${sys.session_id} model=${sys.model}`);
    return null;
  }

  if (message.type === 'assistant') {
    const asst = message as SDKAssistantMessage;
    const now = Date.now() / 1000;
    const nextTurnNum = turnNum + 1;
    const { message: msg } = asst;

    const turnInput = msg.usage?.input_tokens ?? 0;
    const turnOutput = msg.usage?.output_tokens ?? 0;
    record.inputTokens += turnInput;
    record.outputTokens += turnOutput;

    // Register each tool_use block as pending; timing starts now
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        pending.set(block.id, { name: block.name, input: block.input as Record<string, unknown>, startTime: now });
      }
    }

    // Infer stop reason
    const hasToolUse = msg.content.some((b) => b.type === 'tool_use');
    const stopReason = msg.stop_reason ?? (hasToolUse ? 'tool_use' : 'end_turn');
    if (stopReason !== 'tool_use') {
      const textContent = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (textContent) {
        record.finalSummary = textContent;
      }
    }

    const toolUseCount = msg.content.filter((b) => b.type === 'tool_use').length;
    const llmLatency = Math.max(0, now - prevTurnEndTime);

    const turnMetric: TurnMetric = {
      turn: nextTurnNum,
      inputTokens: turnInput,
      outputTokens: turnOutput,
      llmLatency,
      finishReason: normaliseStopReason(stopReason),
      toolCallCount: toolUseCount,
      costUsd: 0,
    };
    record.turnMetrics.push(turnMetric);

    logger.info(
      `[ClaudeCode] Turn ${nextTurnNum}: ${turnInput}in/${turnOutput}out tokens, ` +
        `${toolUseCount} tool(s), finish=${stopReason}`,
    );

    return { turnNum: nextTurnNum, prevTurnEndTime };
  }

  if (message.type === 'user') {
    const userMsg = message as SDKUserMessage;
    const now = Date.now() / 1000;
    const msgContent = userMsg.message?.content;
    const blocks = Array.isArray(msgContent) ? msgContent : [];

    for (const block of blocks) {
      if (typeof block === 'string') continue;
      if (block.type !== 'tool_result') continue;

      const pend = pending.get(block.tool_use_id);
      if (!pend) continue;
      pending.delete(block.tool_use_id);

      const mappedName = translator.mapName(pend.name);
      const rawContent = block.content;
      const resultStr =
        typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent
                .map((c) => (typeof c === 'string' ? c : 'text' in c ? (c as { text: string }).text : ''))
                .join('\n')
                .trim()
            : JSON.stringify(rawContent);

      const elapsed = ((now - pend.startTime) * 1000).toFixed(0);
      const preview = resultStr.slice(0, 80).replace(/\n/g, ' ');

      if (translator.isInternalTool(pend.name)) {
        logger.info(`  [ClaudeCode] ${pend.name} (internal, skipped) (${elapsed}ms)`);
        continue;
      }

      const isError = block.is_error === true;
      const isDoc = translator.isDocLookup(pend.name);
      const isInterrupt = translator.isInterruption(pend.name);
      const toolArgs = translator.normalizeArgs(pend.name, pend.input);

      const isRetry = detectRetry(record.toolCalls, mappedName, toolArgs);
      const recovered = isRetry && !isError;

      const tc: ToolCallRecord = {
        name: mappedName,
        args: toolArgs,
        result: resultStr,
        startTime: pend.startTime,
        endTime: now,
        isDocLookup: isDoc,
        isInterruption: isInterrupt,
        causedError: isError,
        actionType: classifyActionType(mappedName, isError),
        isRetry,
        recoveredFromError: recovered,
      };

      if (isError) {
        tc.errorCategory = classifyErrorCategory(resultStr);
        record.providerErrors.push(`${mappedName}: ${resultStr.slice(0, 200)}`);
      }

      record.toolCalls.push(tc);

      if (isError) {
        logger.error(`  [ClaudeCode] ${pend.name} ✗ (${elapsed}ms) ${preview}`);
      } else {
        logger.info(`  [ClaudeCode] ${pend.name} ✓ (${elapsed}ms)${preview ? ` → ${preview}` : ''}`);
      }
    }

    return { turnNum, prevTurnEndTime: now };
  }

  if (message.type === 'result') {
    const res = message as SDKResultMessage;

    if ('result' in res && res.result && !record.finalSummary) {
      record.finalSummary = res.result;
    }

    if (res.usage) {
      record.inputTokens = res.usage.input_tokens;
      record.outputTokens = res.usage.output_tokens;
    }
    record.costUsd = res.total_cost_usd ?? 0;

    if (record.costUsd > 0 && record.turnMetrics.length > 0) {
      const rawCosts = record.turnMetrics.map((tm) => estimateCost(record.model, tm.inputTokens, tm.outputTokens));
      const rawTotal = rawCosts.reduce((s, c) => s + c, 0);
      const scale = rawTotal > 0 ? record.costUsd / rawTotal : 0;
      for (let i = 0; i < record.turnMetrics.length; i++) {
        const tm = record.turnMetrics[i] as TurnMetric;
        const cost = rawCosts[i];
        if (cost !== undefined) {
          tm.costUsd = cost * scale;
        }
      }
    }

    if (res.subtype === 'success' && !res.is_error) {
      record.status = 'success';
    } else {
      record.status = 'failure';
      const message = ('result' in res ? res.result : undefined) || res.subtype;
      record.providerErrors.push(message);
    }
    return null;
  }

  return null;
}

// ── Stop-reason normaliser ────────────────────────────────────────────────────

/**
 * Maps Anthropic Messages API stop_reason values to the OpenAI-convention
 * FinishReason union used across all runners.
 */
export function normaliseStopReason(reason: string): FinishReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_calls';
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop';
    default:
      return 'unknown';
  }
}
