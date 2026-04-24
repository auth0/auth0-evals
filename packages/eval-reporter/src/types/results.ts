/**
 * Typed result shapes for eval job outputs.
 *
 * These types are inlined from the core framework to avoid a circular
 * dependency. When @a0/eval is extracted, this file will re-export from it.
 */

// Inlined from agent_eval/graders.ts
export enum GraderLevel {
  L1 = 'positive_presence',
  L2 = 'hallucination',
  L3 = 'security',
  L4 = 'structural',
  L5 = 'version_correctness',
}

// Inlined from cli/constants.ts
export type AgentType = 'auth0-ReAct-agent' | 'claude-code' | 'copilot' | 'gemini-cli';

// Inlined from agent_eval/agent-types.ts
export type ErrorCategory = 'not_found' | 'timeout' | 'syntax' | 'auth' | 'network' | 'permission' | 'unknown';

// Inlined from agent_eval/traces.ts
export interface TraceStep {
  step: number;
  actionType: string;
  tool: string;
  narrative: string;
  args: Record<string, unknown>;
  resultPreview: string;
  resultSizeBytes: number;
  resultLines: number;
  duration: number;
  causedError: boolean;
  isDocLookup: boolean;
  isInterruption: boolean;
  isRetry: boolean;
  recoveredFromError: boolean;
  errorCategory: ErrorCategory | undefined;
}

export interface TurnMetricEntry {
  turn: number;
  input_tokens: number;
  output_tokens: number;
  llm_latency: number;
  finish_reason: string;
  tool_call_count: number;
  cost_usd: number;
}

/** Serialised outcome of a single grader check, included in every result type. */
export interface GraderSummary {
  /** Human-readable grader name or description. */
  name: string;
  /** Grader kind: `contains`, `not_contains`, `matches`, `judge`, etc. */
  kind: string;
  /** Whether the grader check passed. */
  passed: boolean;
  /** Short explanation of why the check passed or failed. */
  detail: string;
  /** Grader level, if one was assigned (absent for holistic `judge` graders). */
  level?: GraderLevel;
}

/** Serialised outcome of a single scoring dimension, included in agent results. */
export interface DimensionSummary {
  /** Dimension name, e.g. `"Correctness"` or `"Setup Friction"`. */
  name: string;
  /** Raw 0–100 score for this dimension before weighting. */
  score: number;
  /** Letter grade derived from the raw score (A / B / C / D / F). */
  grade: string;
  /** Fractional weight of this dimension in the overall score (e.g. 0.25). */
  weight: number;
  /** Contribution to the overall score: `score * weight`. */
  weighted: number;
}

/**
 * Result produced by a baseline (single-shot LLM, no tools) job.
 */
export interface BaselineJobResult {
  eval_id: string;
  category: string;
  prompt: string;
  response_text: string;
  model: string;
  mode: 'baseline';
  session_id: string;
  status: 'success' | 'failure';
  grader_pass_rate: number;
  graders_passed: number;
  graders_total: number;
  wall_time: number;
  tokens: number;
  cost_usd: number;
  error: string;
  graders: GraderSummary[];
}

/**
 * Result produced by an agent (ReAct loop with file/shell tools) job.
 */
export interface AgentJobResult {
  eval_id: string;
  category: string;
  prompt: string;
  response_text: string;
  model: string;
  mode: 'agent';
  agent_type?: AgentType;
  tools: string[];
  session_id: string;
  status: 'success' | 'failure';
  overall_score: number;
  overall_grade: string;
  grader_pass_rate: number;
  wall_time: number;
  active_time: number;
  tool_calls: number;
  interruptions: number;
  tokens: number;
  cost_usd: number;
  dimensions: DimensionSummary[];
  graders: GraderSummary[];
  session_trace: TraceStep[];
  turn_metrics: TurnMetricEntry[];
}

/**
 * Result recorded when a job throws an unhandled error.
 */
export interface ErrorJobResult {
  eval_id: string;
  model: string;
  mode: 'baseline' | 'agent';
  agent_type?: AgentType;
  tools: string[];
  category: string;
  status: 'error';
  error: string;
  wall_time: number;
  tokens: number;
  cost_usd: number;
}

/** Union of all possible job result shapes. */
export type JobResult = BaselineJobResult | AgentJobResult | ErrorJobResult;
