/**
 * Grader type definitions.
 */

import type { Page } from 'playwright';

export enum GraderLevel {
  L1 = 'positive_presence',
  L2 = 'hallucination',
  L3 = 'security',
  L4 = 'structural',
  L5 = 'version_correctness',
}

/** Minimal tool call record for event-based graders (subset of the full ToolCallRecord from @a0/eval). */
export interface EventToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
  causedError: boolean;
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
  /** Path to a per-eval Playwright script (runtime graders only). Relative to the eval dir. */
  scriptPath?: string;
}

export interface GraderOptions {
  caseSensitive?: boolean;
}

/** Levels valid for event-based graders (agent-only — no tool calls exist in baseline). */
export type EventGraderLevel = GraderLevel.L4 | GraderLevel.L5;

// ── Runtime (Playwright) grader types ────────────────────────────────────────

/** Test-user credentials + expected display name, injected into the runtime script. */
export interface RuntimeTestUser {
  email: string;
  password: string;
  /** The display name the logged-in UI is expected to show. */
  expectedName: string;
}

/** Context passed to a per-eval Playwright script's default export. */
export interface RuntimeContext {
  /** A Playwright Page already created on a fresh browser context. */
  page: Page;
  /** The base URL the served app is reachable at (e.g. http://localhost:5173). */
  baseURL: string;
  /** Real test-tenant user credentials for the login flow. */
  testUser: RuntimeTestUser;
}

/** Outcome a per-eval Playwright script returns. */
export interface RuntimeOutcome {
  passed: boolean;
  /** Human-readable detail shown in the grader result. */
  detail: string;
}

/** The shape of a per-eval Playwright script's default export. */
export type RuntimeScript = (ctx: RuntimeContext) => Promise<RuntimeOutcome>;
