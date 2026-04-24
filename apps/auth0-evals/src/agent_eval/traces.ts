/**
 * Session trace utilities.
 *
 * Converts a RunRecord's toolCalls into formatted lines and
 * JSON-serialisable objects for post-run analysis and report rendering.
 */

import type { ErrorCategory, RunRecord, ToolCallRecord } from './agent-types.js';

export function formatStep(tc: ToolCallRecord): string {
  const action = tc.actionType;
  const duration = tc.endTime - tc.startTime;
  const args = Object.entries(tc.args)
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
    .join(', ');
  const outcome = tc.causedError ? ' → failed' : '';
  return `${tc.name}(${args})${outcome} [${action}, ${duration.toFixed(1)}s]`;
}

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

export interface TurnMetricEntry {
  turn: number;
  input_tokens: number;
  output_tokens: number;
  llm_latency: number;
  finish_reason: string;
  tool_call_count: number;
  cost_usd: number;
}

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
