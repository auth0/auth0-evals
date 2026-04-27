/**
 * Result serialisers — converts raw runner output into typed JobResult shapes.
 *
 * Centralises the two places in run.ts that previously each built their own
 * result object and duplicated the `graderResults.map()` projection.
 */

import type { GraderResult } from '@a0/eval-graders';
import { serialiseTrace, serialiseTurnMetrics } from '../agent_eval/traces.js';
import type { RunRecord } from '../agent_eval/agent-types.js';
import type { ScoredResult } from '../agent_eval/scorer.js';
import type { BaselineResult } from './baseline.js';
import type { EvalDefinition } from './loader.js';
import type { AgentJobResult, BaselineJobResult, ErrorJobResult, GraderSummary } from '../types/results.js';
import type { Mode } from '../cli/constants.js';

/** Projects a `GraderResult` array to the leaner `GraderSummary` shape stored in results. */
function mapGraders(graderResults: GraderResult[]): GraderSummary[] {
  return graderResults.map((gr) => ({
    name: gr.name,
    kind: gr.kind,
    passed: gr.passed,
    detail: gr.detail,
    level: gr.level,
  }));
}

/**
 * Builds a `BaselineJobResult` from the raw output of a single-shot LLM call.
 *
 * @param evalDef - The eval definition providing id, category, and user prompt.
 * @param result - Raw result returned by `runBaseline()`.
 * @param graderResults - Grader outcomes (L1–L3 only for baseline mode).
 * @param responseText - The model's response text (code blocks already extracted).
 */
export function serialiseBaseline(
  evalDef: EvalDefinition,
  result: BaselineResult,
  graderResults: GraderResult[],
  responseText: string,
): BaselineJobResult {
  const passed = graderResults.filter((r) => r.passed).length;
  const total = graderResults.length;
  const rate = total > 0 ? passed / total : 1.0;
  return {
    eval_id: evalDef.id,
    category: evalDef.category,
    prompt: evalDef.userPrompt,
    response_text: responseText,
    model: result.model,
    mode: 'baseline',
    session_id: result.sessionId,
    status: result.status,
    grader_pass_rate: rate,
    graders_passed: passed,
    graders_total: total,
    wall_time: result.wallTime,
    tokens: result.inputTokens + result.outputTokens,
    cost_usd: result.costUsd,
    error: result.error ?? '',
    graders: mapGraders(graderResults),
  };
}

/**
 * Builds an `AgentJobResult` from a completed agent session.
 *
 * @param evalDef - The eval definition providing id, category, and user prompt.
 * @param record - Full run record produced by the agent loop.
 * @param scored - 8-dimension scored result computed from the run record.
 * @param graderResults - All grader outcomes for the session workspace.
 * @param model - Model identifier used for the session.
 * @param mode - Always `"agent"` — reflected as a literal in the return type.
 * @param tools - Tools that were enabled (e.g. `["skills"]`).
 */
export function serialiseAgent(
  evalDef: EvalDefinition,
  record: RunRecord,
  scored: ScoredResult,
  graderResults: GraderResult[],
  model: string,
  mode: 'agent',
  tools: string[],
): AgentJobResult {
  return {
    eval_id: evalDef.id,
    category: evalDef.category,
    prompt: evalDef.userPrompt,
    response_text: record.finalSummary ?? '',
    model,
    mode,
    tools,
    session_id: record.sessionId,
    status: record.status === 'success' ? 'success' : 'failure',
    overall_score: scored.overallScore,
    overall_grade: scored.overallGrade,
    grader_pass_rate: scored.graderPassRate,
    wall_time: record.endTime - record.startTime,
    active_time: record.toolCalls.reduce((sum, tc) => sum + (tc.endTime - tc.startTime), 0),
    tool_calls: record.toolCalls.length,
    interruptions: record.toolCalls.filter((tc) => tc.isInterruption).length,
    tokens: record.inputTokens + record.outputTokens,
    cost_usd: record.costUsd,
    dimensions: scored.dimensions.map((d) => ({
      name: d.name,
      score: d.rawScore,
      grade: d.grade,
      weight: d.weight,
      weighted: d.weighted,
    })),
    graders: mapGraders(graderResults),
    session_trace: serialiseTrace(record),
    turn_metrics: serialiseTurnMetrics(record),
  };
}

/**
 * Builds an `ErrorJobResult` for a job that threw before producing any output.
 *
 * All numeric fields are zeroed — no timing or token data is available after
 * an unhandled crash.
 *
 * @param evalId - Eval identifier.
 * @param category - Eval category.
 * @param model - Model identifier.
 * @param mode - Execution mode that was attempted.
 * @param tools - Tools that were configured.
 * @param error - Stringified error message.
 */
export function serialiseError(
  evalId: string,
  category: string,
  model: string,
  mode: Mode,
  tools: string[],
  error: string,
): ErrorJobResult {
  return {
    eval_id: evalId,
    model,
    mode,
    tools,
    category,
    status: 'error',
    error,
    wall_time: 0,
    tokens: 0,
    cost_usd: 0,
  };
}
