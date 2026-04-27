/**
 * Types for the 7-dimension scoring system.
 */

import { ErrorCategory } from './agents.js';
import type { GraderLevel } from './graders.js';

// ── Grader result (input to scorer) ──────────────────────────────────────────

/** Outcome of a single grader check, consumed by the scorer. */
export interface GraderResult {
  name: string;
  kind: string;
  passed: boolean;
  detail: string;
  level?: GraderLevel;
}

// ── Run record (input to scorer) ─────────────────────────────────────────────

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
  startTime: number;
  endTime: number;
  isDocLookup: boolean;
  isInterruption: boolean;
  causedError: boolean;
  actionType: string;
  isRetry: boolean;
  recoveredFromError: boolean;
  errorCategory?: ErrorCategory;
}

export interface RunRecord {
  taskName: string;
  model: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  toolCalls: ToolCallRecord[];
  turnMetrics: unknown[];
  providerErrors: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  status: 'running' | 'success' | 'failure';
  finalSummary: string;
  workspace: string;
}

// ── Scorer output ────────────────────────────────────────────────────────────

export interface DimensionScore {
  name: string;
  weight: number;
  rawScore: number;
  grade: string;
  notes: string;
  weighted: number;
}

export interface ScoredResult {
  runRecord: RunRecord;
  dimensions: DimensionScore[];
  overallScore: number;
  overallGrade: string;
  graderResults: GraderResult[];
  graderPassRate: number;
}

// ── Scoring options (consumer overrides) ─────────────────────────────────────

/**
 * Overridable scoring constants. Every field is optional — unset fields
 * fall back to the framework defaults specified in `AGENTS.md`.
 */
export interface ScoringOptions {
  /** Points deducted per interruption in Setup Friction (default: 14) */
  frictionInterruptionPenalty?: number;
  /** Points deducted per provider error in Setup Friction (default: 10) */
  frictionProviderErrorPenalty?: number;

  /** Ideal active tool time in seconds for Setup Speed (default: 60) */
  speedIdealActiveS?: number;
  /** Points deducted per excess second in Setup Speed (default: 0.4) */
  speedDegradationRate?: number;

  /** Ideal number of tool calls for Efficiency (default: 10) */
  efficiencyIdealCalls?: number;

  /** Points deducted per provider error in Error Recovery (default: 20) */
  errorRecoveryPenalty?: number;

  /** Weight overrides for dimensions (must sum to 1.0). Keys are dimension names. */
  weights?: Partial<DimensionWeights>;

  /** Custom tool display name mapping for efficiency notes. */
  toolDisplayNames?: Record<string, string>;
}

export interface DimensionWeights {
  'Setup Friction': number;
  'Setup Speed': number;
  Efficiency: number;
  'Error Recovery': number;
  Correctness: number;
  Hallucination: number;
  Security: number;
}
