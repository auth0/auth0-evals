/**
 * Grader executor interface and context types.
 *
 * Each executor handles one or more grader `kind` values. The registry maps
 * kinds to executors and dispatches grader evaluation through them.
 */

import type { GraderDef, GraderResult } from '@a0/eval-graders';

/**
 * Context passed to every executor. Each executor uses what it needs:
 * - Text-search executors use `files` / `combinedText`
 * - LLM judge uses `files`, `apiKey`, and `judge.*` (all resolved from FrameworkConfig
 *   by the caller before building this context)
 */
export interface GraderContext {
  /** Absolute path to the workspace directory. */
  workspace: string;
  /** Workspace file contents keyed by relative path. */
  files: Record<string, string>;
  /** All files concatenated with `// FILE: <path>` headers — precomputed for text search. */
  combinedText: string;
  /** Lowercase version of combinedText — precomputed for case-insensitive search. */
  combinedLower: string;
  /** API key for LLM calls (judge, future remote graders). */
  apiKey?: string;
  /** Judge-specific configuration. Only required when judge graders are present. */
  judge?: {
    /** Resolved judge model identifier. */
    model: string;
    /** Proxy base URL for the judge LLM API call. */
    baseUrl: string;
    /** Maximum tokens for judge response. */
    maxTokens: number;
    /** Optional custom prompts directory path. */
    promptsDir?: string;
    /** LiteLLM model alias map resolved from FrameworkConfig. */
    modelMap: Record<string, string>;
    /** Maximum code characters for judge input. */
    maxCodeChars: number;
    /** Whether to enforce the max chars limit (throws vs warns). */
    enforceMaxChars: boolean;
  };
}

/**
 * A grader executor handles evaluation for one or more grader kinds.
 */
export interface GraderExecutor {
  /** The grader kind this executor handles. */
  readonly kind: string;
  /** Execute a single grader definition against the given context. */
  execute(def: GraderDef, context: GraderContext): Promise<GraderResult>;
}
