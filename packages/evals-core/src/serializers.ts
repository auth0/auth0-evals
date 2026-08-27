/**
 * Result serialisers — converts raw runner output into typed JobResult shapes.
 *
 * Also includes trace serialisation helpers that convert RunRecord data into
 * the TraceStep[] and TurnMetricEntry[] shapes stored in results.
 *
 * This module is the single choke point for everything a run publishes — the JSON
 * results file, the HTML report, the trace rendered in a dashboard — so every
 * free-text field it emits passes through `redactSecrets` (see `utils/redact.ts`).
 * Redaction here runs *after* graders and the scorer, so it cannot change a verdict
 * or a score, and it keeps the report template free of redaction logic.
 */

import type { GraderResult, RunRecord, ToolCallRecord, ScoredResult } from './types/scorer.js';
import type { TraceStep, TurnMetricEntry } from './types/agents.js';
import type { AgentJobResult, BaselineJobResult, ErrorJobResult, GraderSummary } from './types/results.js';
import type { EvalDefinition } from './types/eval.js';
import type { Recommendations } from './recommendations/types.js';
import { estimateCost } from './config/costs.js';
import { redactArgs, redactSecrets } from './utils/redact.js';

// ── Trace serialisation ───────────────────────────────────────────────────────

/**
 * Format a tool call into a human-readable narrative string.
 *
 * Arguments are redacted before they are rendered: a partial credential is still a
 * leaked credential, so the value is masked whole rather than sliced.
 */
export function formatStep(tc: ToolCallRecord): string {
  const action = tc.actionType;
  const duration = tc.endTime - tc.startTime;
  const args = Object.entries(redactArgs(tc.args))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');
  const outcome = tc.causedError ? ' \u2192 failed' : '';
  return `${tc.name}(${args})${outcome} [${action}, ${duration.toFixed(1)}s]`;
}

/**
 * Convert a RunRecord's tool calls into serialisable TraceStep objects.
 *
 * `result` carries the full tool output with secrets redacted. Sizes and line counts
 * are computed from the *original* result, so the metrics still describe what the tool
 * actually returned rather than the redacted rendering.
 */
export function serialiseTrace(record: RunRecord): TraceStep[] {
  return record.toolCalls.map((tc, i) => ({
    step: i + 1,
    actionType: tc.actionType,
    tool: tc.name,
    narrative: formatStep(tc),
    args: redactArgs(tc.args),
    result: redactSecrets(tc.result),
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

// ── Judge cost helper ─────────────────────────────────────────────────────────

/** Sums token usage across judge grader results and estimates cost per judge model. */
function computeJudgeCost(graderResults: GraderResult[]): number {
  let total = 0;
  for (const gr of graderResults) {
    const input = gr.inputTokens ?? 0;
    const output = gr.outputTokens ?? 0;
    if ((input > 0 || output > 0) && gr.judgeModel) {
      total += estimateCost(gr.judgeModel, input, output);
    }
  }
  return total;
}

// ── Result serialisation ──────────────────────────────────────────────────────

/**
 * Projects a `GraderResult` array to the leaner `GraderSummary` shape stored in results.
 *
 * `detail` is redacted: a failing `contains` grader quotes the workspace text it
 * searched, and a judge rationale quotes the code it read — either can surface a
 * credential the agent wrote.
 */
function mapGraders(graderResults: GraderResult[]): GraderSummary[] {
  return graderResults.map((gr) => {
    const summary: GraderSummary = {
      name: gr.name,
      kind: gr.kind,
      passed: gr.passed,
      detail: redactSecrets(gr.detail),
      level: gr.level,
    };
    if ((gr.inputTokens || gr.outputTokens) && gr.judgeModel) {
      summary.cost_usd = estimateCost(gr.judgeModel, gr.inputTokens ?? 0, gr.outputTokens ?? 0);
    }
    return summary;
  });
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
 *
 * `prompt` is redacted even though prompts are version-controlled and public in this
 * repo. The published report reaches readers with none of that context: they see a
 * rendered panel, not a `PROMPT.md`, and a credential in the clear there reads as a
 * leak regardless of its provenance. Inconsistent redaction within one panel also
 * undermines trust in the redaction elsewhere.
 *
 * `error` is redacted because it is free text from HTTP clients and provider SDKs —
 * the usual place an `Authorization` header surfaces in an exception message.
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
  const judgeCost = computeJudgeCost(graderResults);
  return {
    eval_id: evalDef.id,
    category: evalDef.category,
    prompt: redactSecrets(evalDef.userPrompt),
    response_text: redactSecrets(responseText),
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
    judge_cost_usd: judgeCost,
    total_cost_usd: result.costUsd + judgeCost,
    error: redactSecrets(result.error ?? ''),
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
  recommendations?: Recommendations,
): AgentJobResult {
  const judgeCost = computeJudgeCost(graderResults);
  return {
    eval_id: evalDef.id,
    category: evalDef.category,
    // Redacted for the same reasons as in serialiseBaseline.
    prompt: redactSecrets(evalDef.userPrompt),
    response_text: redactSecrets(record.finalSummary ?? ''),
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
    judge_cost_usd: judgeCost,
    total_cost_usd: record.costUsd + judgeCost,
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
    recommendations,
  };
}

/**
 * Builds an `ErrorJobResult` for a job that threw before producing any output.
 *
 * The error text is redacted: an exception thrown mid-request is one of the few
 * places a credential travels as prose rather than as a keyed value.
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
    error: redactSecrets(error),
    wall_time: 0,
    tokens: 0,
    cost_usd: 0,
    judge_cost_usd: 0,
    total_cost_usd: 0,
  };
}
