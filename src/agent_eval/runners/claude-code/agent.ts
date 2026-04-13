/**
 * Claude Code agent runner using the Claude Agent SDK.
 *
 * Uses the `query()` function from `@anthropic-ai/claude-agent-sdk` to run
 * Claude Code programmatically, replacing the previous subprocess-based approach.
 *
 * The agent system prompt is written to CLAUDE.md in the workspace so Claude Code picks it
 * up as persistent context. The user prompt is passed directly via `query()`.
 *
 * Tool names are mapped via ClaudeCodeTranslator (see tool-translator.ts).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord, ToolCallRecord, TurnMetric, FinishReason } from '../../agent-types.js';
import { classifyActionType, classifyErrorCategory, detectRetry } from '../../agent-types.js';
import type { EvalDefinition } from '../../../runners/loader.js';
import { BASE_URL, CLAUDE_CODE_TASK_TIMEOUT_MS } from '../../../config/settings.js';
import { estimateCost } from '../../../config/costs.js';
import { ClaudeCodeTranslator } from '../../tool-translator.js';
import { logger } from '../../../utils/logger.js';

// Module-level translator instance — all event processing uses this.
const translator = new ClaudeCodeTranslator();

// ── Model alias mapping ───────────────────────────────────────────────────────

/** Whether the runner should use Bedrock model IDs (via the ATKO /anthropic proxy endpoint). */
const USE_BEDROCK = process.env.CLAUDE_CODE_USE_BEDROCK_PROXY !== '0';

/**
 * Maps the short ATKO OpenAI-compat model aliases to the full Bedrock model IDs
 * expected by the claude CLI when routing through the ATKO Anthropic pass-through endpoint.
 *
 * Only used when CLAUDE_CODE_USE_BEDROCK_PROXY !== '0'; in LiteLLM proxy mode the aliases are
 * passed through directly.
 */
const BEDROCK_MODEL_ALIAS_MAP: Record<string, string> = {
  'claude-4-6-sonnet': 'global.anthropic.claude-sonnet-4-6',
  'claude-4-6-opus': 'global.anthropic.claude-opus-4-6-v1',
  'claude-4-5-sonnet': 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-4-5-opus': 'global.anthropic.claude-opus-4-5-20251101-v1:0',
  'claude-4-5-haiku': 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
};

/** Reverse lookup: full Bedrock model ID → friendly ATKO alias. */
const BEDROCK_MODEL_REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(BEDROCK_MODEL_ALIAS_MAP).map(([alias, full]) => [full, alias]),
);

/** Set of known ATKO proxy model aliases — used to validate model IDs in reports. */
const ATKO_KNOWN_MODELS = new Set(Object.keys(BEDROCK_MODEL_ALIAS_MAP));

// ── Public API ────────────────────────────────────────────────────────────────

/** Model identifier written to RunRecord when Claude Code runner is used. */
export const CLAUDE_CODE_MODEL_ID = 'claude-code';

/**
 * ATKO proxy base URL for the Claude CLI.
 * - Bedrock mode: `/anthropic` pass-through endpoint on the ATKO LiteLLM proxy.
 * - LiteLLM mode: proxy root (stripped `/v1` suffix) — handles Anthropic-protocol requests directly.
 * The Agent SDK honours ANTHROPIC_BASE_URL, routing all requests through the proxy
 * instead of hitting api.anthropic.com directly.
 */
const ANTHROPIC_PROXY_URL = USE_BEDROCK ? BASE_URL.replace(/\/v1\/?$/, '/anthropic') : BASE_URL.replace(/\/v1\/?$/, '');

/**
 * Tools available during eval runs.
 * Uses the tools option to replace the full built-in set, preventing Claude Code's
 * internal housekeeping tools (Task, TodoWrite, etc.) from being called.
 *
 * AskUserQuestion is excluded to suppress interactive interruptions during unattended evals.
 */
const DEFAULT_ALLOWED_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'WebFetch', 'Skill'];

export interface ClaudeCodeRunOptions {
  /** Comma-separated list of Claude Code tools to allow. Overrides DEFAULT_ALLOWED_TOOLS. */
  allowedTools?: string;
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
   * Use the Anthropic model ID format (e.g. `claude-sonnet-4-5-20251101`) or
   * an ATKO proxy alias (e.g. `claude-4-6-sonnet`) when routing through the proxy.
   */
  model?: string;
}

/**
 * Writes the agent system prompt as CLAUDE.md in the workspace so Claude Code
 * picks it up as persistent context. No-op when prompt is empty.
 */
export function writeAgentSystemPrompt(workspace: string, prompt: string): void {
  if (prompt) {
    writeFileSync(join(workspace, 'CLAUDE.md'), prompt, 'utf-8');
  }
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
  const { allowedTools, env = {}, tools = [], model } = opts;
  const toolList = allowedTools ? allowedTools.split(',') : DEFAULT_ALLOWED_TOOLS;

  const record: RunRecord = {
    taskName: evalDef.id,
    model: CLAUDE_CODE_MODEL_ID,
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

  // In Bedrock mode, resolve short ATKO alias to the full Bedrock model ID
  // (e.g. claude-4-6-sonnet → global.anthropic.claude-sonnet-4-6).
  // In LiteLLM mode, pass the alias directly — the proxy handles resolution.
  const resolvedModel = model ? (USE_BEDROCK ? (BEDROCK_MODEL_ALIAS_MAP[model] ?? model) : model) : undefined;

  // Build environment variables for the SDK process.
  // Route through the ATKO proxy's Anthropic pass-through endpoint.
  const proxyEnv: Record<string, string> = {
    ANTHROPIC_BASE_URL: ANTHROPIC_PROXY_URL,
  };
  if (process.env.ATKO_API_KEY) {
    proxyEnv.ANTHROPIC_API_KEY = process.env.ATKO_API_KEY;
  }

  // Build MCP server config when --tools mcp is requested.
  const mcpServers = tools.includes('mcp')
    ? { 'auth0-docs': { type: 'http' as const, url: 'https://auth0.com/docs/mcp' } }
    : undefined;

  logger.info(`\n[ClaudeCode] Starting task: ${evalDef.id}`);
  logger.info(`[ClaudeCode] Workspace: ${workspace}`);
  logger.info(`[ClaudeCode] Allowed tools: ${toolList.join(',')}`);
  if (resolvedModel) {
    const modelLabel = resolvedModel !== model ? `${model} → ${resolvedModel}` : resolvedModel;
    logger.info(`[ClaudeCode] Model: ${modelLabel}`);
  }
  if (tools.includes('mcp')) logger.info(`[ClaudeCode] MCP: https://auth0.com/docs/mcp`);
  logger.info(`[ClaudeCode] Proxy: ${ANTHROPIC_PROXY_URL}`);

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
        model: resolvedModel,
        tools: toolList,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        additionalDirectories: [workspace],
        abortController,
        env: { ...process.env, ...proxyEnv, ...env },
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
    // If the SDK query completed without emitting a result message, the status
    // is still 'running'. This can happen when the SDK process exits unexpectedly.
    // Only treat as success if we actually received at least one turn of output;
    // otherwise mark as failure since something likely went wrong.
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
    // Enrich model identifier with the actual underlying model reported by Claude Code.
    // In Bedrock mode the CLI reports full Bedrock IDs — reverse-map to friendly aliases.
    // In LiteLLM mode the CLI reports the alias directly — validate and use as-is.
    record.model = sys.model
      ? (BEDROCK_MODEL_REVERSE_MAP[sys.model] ??
        (ATKO_KNOWN_MODELS.has(sys.model) ? sys.model : `claude-code/${sys.model}`))
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
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (textContent) {
        record.finalSummary = textContent;
      }
    }

    const toolUseCount = msg.content.filter((b) => b.type === 'tool_use').length;

    // LLM latency = wall time from when previous turn's tool results were delivered to now
    const llmLatency = Math.max(0, now - prevTurnEndTime);

    const turnMetric: TurnMetric = {
      turn: nextTurnNum,
      inputTokens: turnInput,
      outputTokens: turnOutput,
      llmLatency,
      finishReason: normaliseStopReason(stopReason),
      toolCallCount: toolUseCount,
      costUsd: 0, // cost is not available per-turn; filled in at result event
    };
    record.turnMetrics.push(turnMetric);

    logger.info(
      `[ClaudeCode] Turn ${nextTurnNum}: ${turnInput}in/${turnOutput}out tokens, ` +
        `${toolUseCount} tool(s), finish=${stopReason}`,
    );

    return { turnNum: nextTurnNum, prevTurnEndTime };
  }

  // Tool results come in user-turn messages as tool_result content blocks
  if (message.type === 'user') {
    const userMsg = message as SDKUserMessage;
    const now = Date.now() / 1000;
    const msgContent = userMsg.message?.content;
    const blocks = Array.isArray(msgContent) ? msgContent : [];

    for (const block of blocks) {
      if (typeof block === 'string') continue;
      if (block.type !== 'tool_result') continue;

      const pend = pending.get(block.tool_use_id);
      if (!pend) continue; // orphaned result — skip
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

      // Internal Claude Code tools (TodoWrite, Task, etc.) are bookkeeping, not task actions.
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

    // Use the final summary from the result event if we don't already have one
    if ('result' in res && res.result && !record.finalSummary) {
      record.finalSummary = res.result;
    }

    // Authoritative token counts and cost
    if (res.usage) {
      record.inputTokens = res.usage.input_tokens;
      record.outputTokens = res.usage.output_tokens;
    }
    record.costUsd = res.total_cost_usd ?? 0;

    // Back-fill per-turn costs. Claude Code only reports a session-level total, so
    // estimate each turn's share using the pricing table, then scale proportionally
    // so per-turn values sum to the authoritative total.
    if (record.costUsd > 0 && record.turnMetrics.length > 0) {
      const rawCosts = record.turnMetrics.map((tm) => estimateCost(record.model, tm.inputTokens, tm.outputTokens));
      const rawTotal = rawCosts.reduce((s, c) => s + c, 0);
      const scale = rawTotal > 0 ? record.costUsd / rawTotal : 0;
      for (let i = 0; i < record.turnMetrics.length; i++) {
        record.turnMetrics[i].costUsd = rawCosts[i] * scale;
      }
    }

    // Success only when the subtype is 'success' with no error flag. Everything else
    // is a failure — result carries the message when available, subtype otherwise.
    if (res.subtype === 'success' && !res.is_error) {
      record.status = 'success';
    } else {
      record.status = 'failure';
      record.providerErrors.push(res.result || res.subtype);
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
