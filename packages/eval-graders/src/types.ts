/**
 * Grader type definitions.
 */

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
}

export interface GraderDef {
  kind: string;
  name: string;
  needle?: string;
  pattern?: string;
  question?: string;
  framework?: string;
  level?: GraderLevel;
  caseSensitive?: boolean;
  predicate?: (toolCalls: EventToolCall[]) => boolean;
}

export interface GraderOptions {
  caseSensitive?: boolean;
}
