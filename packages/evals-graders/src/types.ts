/**
 * Grader type definitions.
 */

export enum GraderLevel {
  L1 = 'positive_presence',
  L2 = 'hallucination',
  L3 = 'security',
  L4 = 'structural',
  L5 = 'version_correctness',
  TraceQuality = 'trace_quality',
}

/** Minimal tool call record for event-based graders (subset of the full ToolCallRecord from @a0/evals). */
export interface EventToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
  causedError: boolean;
}

/** Outcome of running an eval's compile_command against the workspace post-agent. */
export interface CompileResult {
  /** True only if every sub-command exited 0. */
  ok: boolean;
  /** Exit code of the failing (or last) sub-command; null if killed by signal. */
  exitCode: number | null;
  /** Signal that killed the command (e.g. 'SIGTERM' on timeout); null otherwise. */
  signal: string | null;
  /** Combined stdout+stderr of the command run. */
  output: string;
  /** The compile_command string that was executed. */
  command: string;
}

export interface GraderResult {
  name: string;
  kind: string;
  passed: boolean;
  detail: string;
  level?: GraderLevel;
  /** Input tokens consumed by this grader (judge graders only). */
  inputTokens?: number;
  /** Output tokens consumed by this grader (judge graders only). */
  outputTokens?: number;
  /** Model used for this grader call (judge graders only). */
  judgeModel?: string;
}

export interface GraderDef {
  kind: string;
  name: string;
  needle?: string;
  pattern?: string;
  question?: string;
  level?: GraderLevel;
  caseSensitive?: boolean;
  predicate?: (toolCalls: EventToolCall[]) => boolean;
  /**
   * Judge graders only. When true, the agent's command trace is appended to the
   * judge's input alongside workspace files. Needed for evals whose work is
   * entirely CLI invocations (no files to inspect) — e.g. tenant config via the
   * Auth0 CLI — so the judge has something to evaluate. Defaults to false so
   * file-based judges are unaffected.
   */
  includeCommandTrace?: boolean;
  /**
   * Judge graders only. When true (only meaningful alongside includeCommandTrace),
   * the command trace also includes commands that errored, each annotated as failed,
   * so a trace-quality judge can see the agent's wrong turns and dead ends — not just the
   * commands that took effect. Defaults to false, preserving the success-only trace that
   * end-state judges rely on.
   */
  includeFailedCommands?: boolean;
  /**
   * Where to search for the needle / pattern / judge input.
   *
   * - `'files'` (default) — workspace files only (existing behavior, unchanged).
   * - `'response'` — agent's final reply text only (no file search).
   * - `'both'` — workspace files AND agent reply text.
   *
   * Use `'response'` or `'both'` for MCP-only evals where the agent never writes
   * files and the answer lives entirely in its final text reply.
   */
  source?: GraderSource;
  /**
   * Judge graders only. Grounding context prepended to the judge's prompt (as a
   * `Context:` block before the question) but kept out of `name`, so it never
   * surfaces on the leaderboard UI. Use it to pin the installed SDK version /
   * API surface so the judge doesn't flag real current APIs as hallucinated,
   * without leaking that hint into the human-facing question label.
   */
  context?: string;
  /**
   * contains / not_contains / not_contains_in_source only. When true, comments
   * are stripped from source files before searching (string literals kept), so
   * the needle matches real code but not a mention in a line or block comment.
   * Defaults to false (search raw file text, unchanged). Only affects the file
   * corpus, not the agent reply.
   */
  ignoreComments?: boolean;
}

export interface GraderOptions {
  caseSensitive?: boolean;
  /**
   * Where to search — see `GraderDef.source` for semantics.
   * Defaults to `'files'` (workspace files only).
   */
  source?: GraderSource;
  /**
   * Strip comments from source files before searching (string literals kept).
   * See `GraderDef.ignoreComments`. Defaults to false.
   */
  ignoreComments?: boolean;
}

/** Levels valid for event-based graders (agent-only — no tool calls exist in baseline). */
export type EventGraderLevel = GraderLevel.L4 | GraderLevel.L5;

/** Level valid for notRanCommand — a hallucination (L2) check on the command trace. */
export type NotRanCommandLevel = GraderLevel.L2;

/**
 * Where a text-search or judge grader looks for its content.
 * - `'files'` (default) — workspace files only.
 * - `'response'` — agent's final reply text only (no file search).
 * - `'both'` — workspace files AND agent reply text.
 */
export type GraderSource = 'files' | 'response' | 'both';
