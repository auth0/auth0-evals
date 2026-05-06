/**
 * Result serialisers — converts raw runner output into typed JobResult shapes.
 *
 * Also includes trace serialisation helpers that convert RunRecord data into
 * the TraceStep[] and TurnMetricEntry[] shapes stored in results.
 */

import type { GraderResult, RunRecord, ToolCallRecord, ScoredResult } from './types/scorer.js';
import type { TraceStep, TurnMetricEntry } from './types/agents.js';
import type { AgentJobResult, BaselineJobResult, ErrorJobResult, GraderSummary } from './types/results.js';
import type { EvalDefinition } from './types/eval.js';

// ── Trace serialisation ───────────────────────────────────────────────────────

/** Format a tool call into a human-readable narrative string. */
export function formatStep(tc: ToolCallRecord): string {
  const action = tc.actionType;
  const duration = tc.endTime - tc.startTime;
  const args = Object.entries(tc.args)
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
    .join(', ');
  const outcome = tc.causedError ? ' \u2192 failed' : '';
  return `${tc.name}(${args})${outcome} [${action}, ${duration.toFixed(1)}s]`;
}

/** Convert a RunRecord's tool calls into serialisable TraceStep objects. */
export function serialiseTrace(record: RunRecord): TraceStep[] {
  return record.toolCalls.map((tc, i) => ({
    step: i + 1,
    actionType: tc.actionType,
    tool: tc.name,
    narrative: formatStep(tc),
    args: tc.args,
    resultPreview: tc.result.slice(0, 300),
    resultSizeBytes: Buffer.byteLength(tc.result, 'utf-8'),
    resultLines: tc.result ? tc.result.split('\n').length : 0,
    duration: Math.round((tc.endTime - tc.startTime) * 1000) / 1000,
    causedError: tc.causedError,
    isDocLookup: tc.isDocLookup,
    isInterruption: tc.isInterruption,
    isRetry: tc.isRetry,
    recoveredFromError: tc.recoveredFromError,
    errorCategory: tc.errorCategory,
  }));
}

/** Convert a RunRecord's turn metrics into serialisable TurnMetricEntry objects. */
export function serialiseTurnMetrics(record: RunRecord): TurnMetricEntry[] {
  return record.turnMetrics.map((tm) => ({
    turn: tm.turn,
    input_tokens: tm.inputTokens,
    output_tokens: tm.outputTokens,
    llm_latency: Math.round(tm.llmLatency * 1000) / 1000,
    finish_reason: tm.finishReason,
    tool_call_count: tm.toolCallCount,
    cost_usd: Math.round(tm.costUsd * 1_000_000) / 1_000_000,
  }));
}

// ── Result serialisation ──────────────────────────────────────────────────────

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

/** Shape of raw baseline runner output consumed by serialiseBaseline. */
export interface BaselineResult {
  evalId: string;
  model: string;
  mode: string;
  sessionId: string;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  wallTime: number;
  status: 'success' | 'failure';
  error: string;
}

/** Execution mode discriminant. */
export type Mode = 'baseline' | 'agent';

/**
 * Builds a `BaselineJobResult` from the raw output of a single-shot LLM call.
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
