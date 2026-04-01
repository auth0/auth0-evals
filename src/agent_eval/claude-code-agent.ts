/**
 * Claude Code CLI agent runner.
 *
 * Spawns the `claude` CLI in non-interactive print mode with `--output-format stream-json`,
 * parses the JSONL event stream, and converts it into the RunRecord format consumed by the
 * scorer and report pipeline.
 *
 * The agent system prompt is written to CLAUDE.md in the workspace so Claude Code picks it
 * up as persistent context. The user prompt is passed directly via `--print`.
 *
 * Tool name mapping (Claude Code → our taxonomy):
 *   Bash / MultiEdit / Edit / Write  →  run_command / write_file / write_file / write_file
 *   Read                             →  read_file
 *   Glob / Grep / LS                 →  list_files
 *   WebFetch / WebSearch             →  fetch_url
 *   AskUserQuestion                  →  ask_user
 */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord, ToolCallRecord, TurnMetric, FinishReason } from './agent-types.js';
import { classifyActionType, classifyErrorCategory, detectRetry } from './agent-types.js';
import type { EvalDefinition } from '../runners/loader.js';
import { BASE_URL } from '../config/settings.js';

// ── Tool name mapping ─────────────────────────────────────────────────────────

/** Maps Claude Code tool names to our internal taxonomy used by the scorer. */
const CC_TOOL_MAP: Record<string, string> = {
  Bash: 'run_command',
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'write_file',
  MultiEdit: 'write_file',
  Glob: 'list_files',
  Grep: 'list_files',
  LS: 'list_files',
  WebFetch: 'fetch_url',
  WebSearch: 'fetch_url',
  AskUserQuestion: 'ask_user',
  TodoRead: 'read_file',
};

const DOC_LOOKUP_TOOLS = new Set(['WebFetch', 'WebSearch']);
const INTERRUPTION_TOOLS = new Set(['AskUserQuestion']);

// ── Model alias mapping ───────────────────────────────────────────────────────

/**
 * Maps the short ATKO OpenAI-compat model aliases (used by the ReAct agent via
 * /v1/chat/completions) to the full Anthropic pass-through model IDs expected by
 * the claude CLI when routing through the ATKO Anthropic endpoint.
 *
 * This lets callers use a single standard name (e.g. `claude-4-6-sonnet`) for
 * both agent runners without worrying about which endpoint each one targets.
 */
const ATKO_MODEL_ALIAS_MAP: Record<string, string> = {
  'claude-4-6-sonnet': 'global.anthropic.claude-sonnet-4-6',
  'claude-4-6-opus': 'global.anthropic.claude-opus-4-6',
  'claude-4-5-sonnet': 'global.anthropic.claude-sonnet-4-5',
  'claude-4-5-opus': 'global.anthropic.claude-opus-4-5',
  'claude-4-5-haiku': 'global.anthropic.claude-haiku-4-5',
};

export function mapToolName(ccName: string): string {
  return CC_TOOL_MAP[ccName] ?? ccName.toLowerCase();
}

// ── Claude Code stream-json event shapes ─────────────────────────────────────

export interface CcSystemEvent {
  type: 'system';
  subtype: string;
  session_id: string;
  model: string;
  cwd: string;
}

export interface CcContentText {
  type: 'text';
  text: string;
}

export interface CcContentToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CcAssistantEvent {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    content: (CcContentText | CcContentToolUse)[];
    model: string;
    stop_reason: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
}

export interface CcToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | { type: string; text: string }[];
  is_error?: boolean;
}

// Tool results arrive as user-turn events (matches the Anthropic Messages API shape)
export interface CcUserEvent {
  type: 'user';
  message: {
    role: 'user';
    content: CcToolResultContent[];
  };
}

export interface CcResultEvent {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution';
  is_error: boolean;
  result: string;
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
  num_turns: number;
  usage: { input_tokens: number; output_tokens: number };
}

export type CcEvent = CcSystemEvent | CcAssistantEvent | CcUserEvent | CcResultEvent | { type: string };

// ── Public API ────────────────────────────────────────────────────────────────

/** Model identifier written to RunRecord when Claude Code runner is used. */
export const CLAUDE_CODE_MODEL_ID = 'claude-code';

/**
 * Anthropic pass-through URL on the ATKO LiteLLM proxy.
 * Derived from BASE_URL by replacing the OpenAI-compat `/v1` suffix with `/anthropic`.
 * The `claude` CLI honours ANTHROPIC_BASE_URL, routing all requests through the proxy
 * instead of hitting api.anthropic.com directly.
 */
const ANTHROPIC_PROXY_URL = BASE_URL.replace(/\/v1\/?$/, '/anthropic');

/**
 * Tools available during eval runs.
 * Uses --tools (not --allowedTools) to replace the full built-in set, preventing Claude Code's
 * internal housekeeping tools (Task, TaskOutput, TodoWrite, TodoRead, EnterPlanMode, etc.)
 * from being called. Those tools inflate tool-call count and wall time without contributing
 * to the actual integration task.
 *
 * AskUserQuestion is excluded to suppress interactive interruptions during unattended evals.
 */
const DEFAULT_ALLOWED_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'WebFetch'].join(
  ',',
);

/**
 * Claude Code internal tools that appear in the stream but should not be counted
 * toward efficiency/friction scoring — they are Claude Code's own bookkeeping, not
 * agent actions on the task.
 */
const INTERNAL_TOOLS = new Set([
  'TodoWrite',
  'TodoRead',
  'Task',
  'TaskOutput',
  'KillShell',
  'EnterPlanMode',
  'ExitPlanMode',
]);

export interface ClaudeCodeRunOptions {
  /** Path to the `claude` binary. Defaults to `claude` (resolved via PATH). */
  claudeBin?: string;
  /** Comma-separated list of Claude Code tools to allow. Overrides DEFAULT_ALLOWED_TOOLS. */
  allowedTools?: string;
  /** Extra env vars forwarded to the subprocess. */
  env?: Record<string, string>;
  /**
   * Tool flags from the eval runner (e.g. `['mcp', 'skills']`).
   * When `'mcp'` is present, the Auth0 docs MCP server is registered with Claude Code
   * via `--mcp-config` so it can call `search_auth0_docs` during the session.
   */
  tools?: string[];
  /**
   * Claude model identifier to pass to the CLI via `--model`.
   * When omitted the CLI uses its own default model.
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
 * Writes the Auth0 docs MCP server config to .mcp-config.json and returns the
 * path so it can be passed to the CLI via --mcp-config.
 */
export function writeMcpConfig(workspace: string): string {
  const mcpConfigPath = join(workspace, '.mcp-config.json');
  const mcpConfig = {
    mcpServers: {
      'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
    },
  };
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
  return mcpConfigPath;
}

/**
 * Runs a Claude Code CLI agent against an eval definition and returns a RunRecord
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
  const { claudeBin = 'claude', allowedTools = DEFAULT_ALLOWED_TOOLS, env = {}, tools = [], model } = opts;

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

  // Resolve short ATKO OpenAI-compat alias to the full Anthropic pass-through model ID
  // the claude CLI expects (e.g. claude-4-6-sonnet → global.anthropic.claude-sonnet-4-6).
  // This lets callers use the same model name for both ReAct and Claude Code runners.
  const resolvedModel = model ? (ATKO_MODEL_ALIAS_MAP[model] ?? model) : undefined;

  const args = [
    '--print',
    evalDef.userPrompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--add-dir',
    workspace,
    '--tools', // replaces the full built-in set — blocks Task/TodoWrite/etc.
    allowedTools,
    '--no-session-persistence',
    '--dangerously-skip-permissions',
  ];

  // Pin the model when one is provided.
  if (resolvedModel) {
    args.push('--model', resolvedModel);
  }

  // Wire up the Auth0 docs MCP server when --tools mcp is requested.
  // Claude Code's --mcp-config flag registers the server for the session,
  // giving the model access to search_auth0_docs alongside its built-in tools.
  if (tools.includes('mcp')) {
    args.push('--mcp-config', writeMcpConfig(workspace));
  }

  console.log(`\n[ClaudeCode] Starting task: ${evalDef.id}`);
  console.log(`[ClaudeCode] Workspace: ${workspace}`);
  console.log(`[ClaudeCode] Allowed tools: ${allowedTools}`);
  if (resolvedModel) {
    const modelLabel = resolvedModel !== model ? `${model} → ${resolvedModel}` : resolvedModel;
    console.log(`[ClaudeCode] Model: ${modelLabel}`);
  }
  if (tools.includes('mcp')) console.log(`[ClaudeCode] MCP: https://auth0.com/docs/mcp`);
  console.log(`[ClaudeCode] Proxy: ${ANTHROPIC_PROXY_URL}`);

  return new Promise<RunRecord>((resolve) => {
    // Route the claude CLI through the ATKO proxy's Anthropic pass-through endpoint.
    // ANTHROPIC_BASE_URL tells the Anthropic SDK (used internally by claude CLI) where
    // to send requests. ANTHROPIC_API_KEY is set to the ATKO key so the proxy accepts auth.
    const proxyEnv: Record<string, string> = {
      ANTHROPIC_BASE_URL: ANTHROPIC_PROXY_URL,
    };
    if (process.env.ATKO_API_KEY) {
      proxyEnv.ANTHROPIC_API_KEY = process.env.ATKO_API_KEY;
    }

    const child = spawn(claudeBin, args, {
      cwd: workspace,
      env: { ...process.env, ...proxyEnv, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const TASK_TIMEOUT_MS = 50 * 300_000;
    const taskTimeout = setTimeout(() => {
      record.providerErrors.push(`task timeout: killed after ${TASK_TIMEOUT_MS / 1000}s`);
      record.status = 'failure';
      console.log(`[ClaudeCode] ✗ Task timeout after ${TASK_TIMEOUT_MS / 1000}s — killing subprocess`);
      child.kill('SIGTERM');
    }, TASK_TIMEOUT_MS);

    let stdoutBuf = '';
    let stderrBuf = '';

    // Pending tool_use blocks awaiting their tool_result: id → { name, input, startTime }
    const pending = new Map<string, { name: string; input: Record<string, unknown>; startTime: number }>();

    // Mutable turn state threaded through the stream processor
    const streamState: StreamState = { turnNum: 0, prevTurnEndTime: record.startTime, parseFailures: 0 };

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf = processStreamChunk(stdoutBuf, chunk.toString(), record, pending, streamState);
    });

    child.on('error', (err) => {
      clearTimeout(taskTimeout);
      record.endTime = Date.now() / 1000;
      record.status = 'failure';
      record.providerErrors.push(`spawn error: ${err.message}`);
      console.log(`[ClaudeCode] ✗ Spawn failed: ${err.message}`);
      resolve(record);
    });

    child.on('close', (code) => {
      clearTimeout(taskTimeout);
      // Flush any remaining buffered output. The last line from the claude CLI (typically the
      // `result` event carrying total_cost_usd and authoritative token counts) may arrive
      // without a trailing newline, leaving it stranded in stdoutBuf. Appending '\n' forces
      // processStreamChunk to treat it as a complete line.
      if (stdoutBuf.trim()) {
        processStreamChunk(stdoutBuf, '\n', record, pending, streamState);
        stdoutBuf = '';
      }

      if (streamState.parseFailures > 0 && streamState.turnNum === 0) {
        record.status = 'failure';
        record.providerErrors.push(
          `stream parse error: ${streamState.parseFailures} line(s) failed to parse and no events were processed — stream format may have changed`,
        );
        console.log(
          `[ClaudeCode] ✗ Stream parse failure: ${streamState.parseFailures} unparseable line(s), 0 turns recorded`,
        );
      }

      // Drain any tool_use blocks that never received a result — these indicate the stream
      // was cut short or a result event was lost (e.g. due to a timeout or spawn error).
      // Create a synthetic ToolCallRecord for each so the scorer sees the incomplete work.
      const now = Date.now() / 1000;
      for (const [id, pend] of pending) {
        if (!INTERNAL_TOOLS.has(pend.name)) {
          const mappedName = mapToolName(pend.name);
          const normArgs = normaliseToolArgs(pend.name, pend.input);
          record.toolCalls.push({
            name: mappedName,
            args: normArgs,
            result: '<orphaned: result event never received>',
            startTime: pend.startTime,
            endTime: now,
            isDocLookup: DOC_LOOKUP_TOOLS.has(pend.name),
            isInterruption: INTERRUPTION_TOOLS.has(pend.name),
            causedError: true,
            actionType: classifyActionType(mappedName, true),
            isRetry: detectRetry(record.toolCalls, mappedName, normArgs),
            recoveredFromError: false,
            errorCategory: 'unknown',
          });
          record.providerErrors.push(`orphaned tool_use: ${pend.name} (id=${id}) never received a result`);
          console.log(`[ClaudeCode] ⚠ Orphaned tool_use: ${pend.name} (id=${id})`);
        }
      }
      pending.clear();

      record.endTime = Date.now() / 1000;
      if (record.status === 'running') {
        record.status = code === 0 ? 'success' : 'failure';
        if (code !== 0) {
          const errPreview = stderrBuf.slice(0, 1000).trim();
          record.providerErrors.push(`exit code ${code}${errPreview ? `: ${errPreview}` : ''}`);
          console.log(`[ClaudeCode] ✗ Exited with code ${code}${errPreview ? `\n${errPreview}` : ''}`);
        }
      }
      console.log(
        `[ClaudeCode] Done — status=${record.status} turns=${streamState.turnNum} ` +
          `tools=${record.toolCalls.length} cost=$${record.costUsd.toFixed(4)}`,
      );
      resolve(record);
    });
  });
}

// ── Event processor ───────────────────────────────────────────────────────────

export interface TurnStateUpdate {
  turnNum: number;
  prevTurnEndTime: number;
}

export function handleEvent(
  ev: CcEvent,
  record: RunRecord,
  pending: Map<string, { name: string; input: Record<string, unknown>; startTime: number }>,
  turnNum: number,
  prevTurnEndTime: number,
): TurnStateUpdate | null {
  if (ev.type === 'system') {
    const sys = ev as CcSystemEvent;
    // Skip hook_response and other non-init system events
    if (sys.subtype !== 'init') return null;
    // Enrich model identifier with the actual underlying model reported by Claude Code
    record.model = sys.model ? `claude-code/${sys.model}` : CLAUDE_CODE_MODEL_ID;
    record.sessionId = sys.session_id;
    console.log(`[ClaudeCode] Session ${sys.session_id} model=${sys.model}`);
    return null;
  }

  if (ev.type === 'assistant') {
    const asst = ev as CcAssistantEvent;
    const now = Date.now() / 1000;
    const nextTurnNum = turnNum + 1;
    const { message } = asst;

    const turnInput = message.usage?.input_tokens ?? 0;
    const turnOutput = message.usage?.output_tokens ?? 0;
    record.inputTokens += turnInput;
    record.outputTokens += turnOutput;

    // Register each tool_use block as pending; timing starts now
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        pending.set(block.id, { name: block.name, input: block.input, startTime: now });
      }
    }

    // Infer stop reason: stream-json sends stop_reason as null; derive from content shape
    const hasToolUse = message.content.some((b) => b.type === 'tool_use');
    const stopReason = message.stop_reason ?? (hasToolUse ? 'tool_use' : 'end_turn');
    if (stopReason !== 'tool_use') {
      const textContent = message.content
        .filter((b): b is CcContentText => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (textContent) {
        record.finalSummary = textContent;
      }
    }

    const toolUseCount = message.content.filter((b) => b.type === 'tool_use').length;

    // LLM latency = wall time from when previous turn's tool results were delivered to now
    const llmLatency = Math.max(0, now - prevTurnEndTime);

    const turnMetric: TurnMetric = {
      turn: nextTurnNum,
      inputTokens: turnInput,
      outputTokens: turnOutput,
      llmLatency,
      finishReason: normaliseStopReason(stopReason),
      toolCallCount: toolUseCount,
      costUsd: 0, // cost is not available per-turn from Claude Code; filled in at result event
    };
    record.turnMetrics.push(turnMetric);

    console.log(
      `[ClaudeCode] Turn ${nextTurnNum}: ${turnInput}in/${turnOutput}out tokens, ` +
        `${toolUseCount} tool(s), finish=${stopReason}`,
    );

    return { turnNum: nextTurnNum, prevTurnEndTime };
  }

  // Tool results come in user-turn events as tool_result content blocks
  if (ev.type === 'user') {
    const userEv = ev as CcUserEvent;
    const now = Date.now() / 1000;
    const blocks = userEv.message?.content ?? [];

    for (const block of blocks) {
      if (block.type !== 'tool_result') continue;

      const pend = pending.get(block.tool_use_id);
      if (!pend) continue; // orphaned result — skip
      pending.delete(block.tool_use_id);

      const mappedName = mapToolName(pend.name);
      const rawContent = block.content;
      const resultStr =
        typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent
                .map((c) => c.text ?? '')
                .join('\n')
                .trim()
            : JSON.stringify(rawContent);

      const elapsed = ((now - pend.startTime) * 1000).toFixed(0);
      const preview = resultStr.slice(0, 80).replace(/\n/g, ' ');

      // Internal Claude Code tools (TodoWrite, Task, etc.) are bookkeeping, not task actions.
      // Log them for visibility but don't add to toolCalls so they don't distort scoring.
      if (INTERNAL_TOOLS.has(pend.name)) {
        console.log(`  [ClaudeCode] ${pend.name} (internal, skipped) (${elapsed}ms)`);
        continue;
      }

      const isError = block.is_error === true;
      const isDoc = DOC_LOOKUP_TOOLS.has(pend.name) || pend.name.startsWith('mcp__');
      const isInterrupt = INTERRUPTION_TOOLS.has(pend.name);
      const toolArgs = normaliseToolArgs(pend.name, pend.input);

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
        console.log(`  [ClaudeCode] ${pend.name} ✗ (${elapsed}ms) ${preview}`);
      } else {
        console.log(`  [ClaudeCode] ${pend.name} ✓ (${elapsed}ms)${preview ? ` → ${preview}` : ''}`);
      }
    }

    return { turnNum, prevTurnEndTime: now };
  }

  if (ev.type === 'result') {
    const res = ev as CcResultEvent;

    // Use the final summary from the result event if we don't already have one
    if (res.result && !record.finalSummary) {
      record.finalSummary = res.result;
    }

    // Authoritative token counts and cost from Claude Code's own accounting
    if (res.usage) {
      record.inputTokens = res.usage.input_tokens;
      record.outputTokens = res.usage.output_tokens;
    }
    record.costUsd = res.total_cost_usd ?? 0;

    switch (res.subtype) {
      case 'success':
        record.status = 'success';
        break;
      case 'error_max_turns':
        record.status = 'failure';
        record.providerErrors.push('max_turns_reached');
        break;
      default:
        record.status = 'failure';
        record.providerErrors.push(`result subtype: ${res.subtype}`);
    }
    return null;
  }

  return null;
}

// ── Stream chunk processor ────────────────────────────────────────────────────

/** Mutable state threaded through processStreamChunk calls during a subprocess run. */
export interface StreamState {
  turnNum: number;
  prevTurnEndTime: number;
  parseFailures: number;
}

/**
 * Processes a chunk of stdout bytes against the accumulated line buffer.
 *
 * Splits by newline, parses each JSONL event, delegates to handleEvent, and
 * tracks parse failures with a logged preview. Returns the new partial-line
 * buffer (the last incomplete line awaiting a future newline).
 *
 * Extracted from the subprocess stdout handler so it can be unit-tested
 * without a live child process.
 */
export function processStreamChunk(
  buf: string,
  chunk: string,
  record: RunRecord,
  pending: Map<string, { name: string; input: Record<string, unknown>; startTime: number }>,
  state: StreamState,
): string {
  const lines = (buf + chunk).split('\n');
  const remaining = lines.pop() ?? '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let ev: CcEvent;
    try {
      ev = JSON.parse(line) as CcEvent;
    } catch (e) {
      state.parseFailures++;
      const preview = raw.slice(0, 120);
      console.error(`[ClaudeCode] ✗ Stream parse error (failure #${state.parseFailures}): ${preview} — ${e}`);
      record.providerErrors.push(`stream_parse_error: ${preview.slice(0, 80)}`);
      continue;
    }

    const update = handleEvent(ev, record, pending, state.turnNum, state.prevTurnEndTime);
    if (update) {
      state.turnNum = update.turnNum;
      state.prevTurnEndTime = update.prevTurnEndTime;
    }
  }

  return remaining;
}

// ── Stop-reason normaliser ────────────────────────────────────────────────────

/**
 * Maps Anthropic Messages API stop_reason values to the OpenAI-convention
 * FinishReason union used across all runners.
 *
 * Anthropic → FinishReason:
 *   tool_use       → tool_calls
 *   end_turn       → stop
 *   max_tokens     → max_tokens
 *   stop_sequence  → stop
 *   <anything else> → unknown
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

// ── Tool arg normalisers ──────────────────────────────────────────────────────

/**
 * Remaps Claude Code's tool input shapes to the arg schema our scorer and trace
 * serialiser expect (e.g. `path` for file operations, `command` for shell, `url` for fetch).
 */
export function normaliseToolArgs(ccName: string, input: Record<string, unknown>): Record<string, unknown> {
  switch (ccName) {
    case 'Bash':
      return { command: input.command ?? input.cmd ?? '' };
    case 'Read':
      return { path: input.file_path ?? input.path ?? '' };
    case 'Write':
      return { path: input.file_path ?? input.path ?? '', content: input.content ?? '' };
    case 'Edit':
      return { path: input.file_path ?? input.path ?? '', content: input.new_string ?? input.content ?? '' };
    case 'MultiEdit':
      return { path: input.file_path ?? input.path ?? '' };
    case 'Glob':
      return { path: input.pattern ?? input.path ?? '' };
    case 'Grep':
      return { path: input.path ?? '.', command: `grep "${String(input.pattern ?? '')}"` };
    case 'LS':
      return { path: input.path ?? '.' };
    case 'WebFetch':
      return { url: input.url ?? '' };
    case 'WebSearch':
      return { url: input.query ?? '' };
    case 'AskUserQuestion':
      return { question: input.question ?? '' };
    default:
      return input;
  }
}
