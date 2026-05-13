/**
 * Typed result shapes for eval job outputs.
 */

import type { GraderLevel } from './graders.js';
import type { TraceStep, TurnMetricEntry } from './agents.js';
import type { AgentType } from './agents.js';

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
 *
 * Only L1–L3 graders are run for baseline mode; the full 8-dimension
 * scorer is not applied.
 */
export interface BaselineJobResult {
  /** Eval identifier, e.g. `"react_quickstart"`. */
  eval_id: string;
  /** Eval category, e.g. `"quickstarts"`. */
  category: string;
  /** The user prompt that was sent to the model. */
  prompt: string;
  /** Raw text returned by the model. */
  response_text: string;
  /** Model identifier used for this run. */
  model: string;
  /** Discriminant — always `"baseline"` for this type. */
  mode: 'baseline';
  /** Opaque session identifier for correlation. */
  session_id: string;
  /** Terminal status of the LLM call. */
  status: 'success' | 'failure';
  /** Fraction of graders that passed (0–1). */
  grader_pass_rate: number;
  /** Number of graders that passed. */
  graders_passed: number;
  /** Total number of graders that were run. */
  graders_total: number;
  /** Wall-clock duration in seconds. */
  wall_time: number;
  /** Total tokens consumed (input + output). */
  tokens: number;
  /** Estimated cost in USD. */
  cost_usd: number;
  /** Error message if the run failed, empty string otherwise. */
  error: string;
  /** Per-grader pass/fail detail. */
  graders: GraderSummary[];
}

/**
 * Result produced by an agent (agentic loop with file/shell tools) job.
 *
 * All 8 scoring dimensions and the full grader suite are applied.
 * Includes a full session trace and per-turn token metrics.
 */
export interface AgentJobResult {
  /** Eval identifier, e.g. `"react_quickstart"`. */
  eval_id: string;
  /** Eval category, e.g. `"quickstarts"`. */
  category: string;
  /** The user prompt that was sent to the agent. */
  prompt: string;
  /** The agent's final summary text. */
  response_text: string;
  /** Model identifier used for this run. */
  model: string;
  /** Discriminant — always `"agent"` for this type. */
  mode: 'agent';
  /** Agent runner that produced this result, e.g. `"claude-code"` or `"copilot"`. */
  agent_type?: AgentType;
  /** Tools that were enabled for this run (e.g. `["skills"]`). */
  tools: string[];
  /** Opaque session identifier for correlation. */
  session_id: string;
  /** Terminal status of the agent loop. */
  status: 'success' | 'failure';
  /** Weighted overall score across all 8 dimensions (0–100). */
  overall_score: number;
  /** Letter grade for the overall score (A / B / C / D / F). */
  overall_grade: string;
  /** Fraction of graders that passed (0–1). */
  grader_pass_rate: number;
  /** Wall-clock duration from session start to finish, in seconds. */
  wall_time: number;
  /** Cumulative time spent inside tool calls, in seconds. */
  active_time: number;
  /** Total number of tool calls made by the agent. */
  tool_calls: number;
  /** Number of tool calls that required a human interruption. */
  interruptions: number;
  /** Total tokens consumed (input + output). */
  tokens: number;
  /** Estimated cost in USD. */
  cost_usd: number;
  /** Per-dimension score breakdown. */
  dimensions: DimensionSummary[];
  /** Per-grader pass/fail detail. */
  graders: GraderSummary[];
  /** Chronological list of tool calls made during the session. */
  session_trace: TraceStep[];
  /** Per-turn token and latency metrics. */
  turn_metrics: TurnMetricEntry[];
}

/**
 * Result recorded when a job throws an unhandled error before producing
 * any grader or scoring output.
 */
export interface ErrorJobResult {
  /** Eval identifier. */
  eval_id: string;
  /** Model identifier. */
  model: string;
  /** Execution mode that was attempted when the error occurred. */
  mode: 'baseline' | 'agent';
  /** Agent runner that was configured when the error occurred (agent mode only). */
  agent_type?: AgentType;
  /** Tools that were configured when the error occurred. */
  tools: string[];
  /** Eval category. */
  category: string;
  /** Always `"error"` — discriminant for this variant. */
  status: 'error';
  /** Stringified error message. */
  error: string;
  /** Always `0` — no meaningful timing available after a crash. */
  wall_time: number;
  /** Always `0`. */
  tokens: number;
  /** Always `0`. */
  cost_usd: number;
}

/** Union of all possible job result shapes returned by `runJob()`. */
export type JobResult = BaselineJobResult | AgentJobResult | ErrorJobResult;
