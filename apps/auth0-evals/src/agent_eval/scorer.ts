/**
 * 7-dimension scorer.
 *
 * Process dimensions (50%): Setup Friction (14%), Setup Speed (14%), Efficiency (14%),
 * Error Recovery (8%)
 *
 * Output dimensions (50%): Correctness (25%), Hallucination (15%), Security (10%)
 *
 * Each dimension is scored 0–100 and maps to a letter grade.
 * Overall score = weighted sum across all 7 dimensions.
 */

import type { RunRecord } from './agent-types.js';
import { GraderLevel, type GraderResult } from '@a0/eval-graders';
import { passRate as graderPassRateFn } from './graders.js';
import { formatToolSummary } from './tool-display-names.js';

// ── Scoring constants ─────────────────────────────────────────────────────────

const GRADE_A_MIN = 90;
const GRADE_B_MIN = 75;
const GRADE_C_MIN = 60;
const GRADE_D_MIN = 40;

const FRICTION_INTERRUPTION_PENALTY = 14.0;
const FRICTION_PROVIDER_ERROR_PENALTY = 10.0;

const SPEED_IDEAL_ACTIVE_S = 60.0;
const SPEED_DEGRADATION_RATE = 0.4;

const EFFICIENCY_IDEAL_CALLS = 10;

const ERROR_RECOVERY_PENALTY = 20.0;

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Grade thresholds ──────────────────────────────────────────────────────────

export function scoreToGrade(score: number): string {
  if (score >= GRADE_A_MIN) return 'A';
  if (score >= GRADE_B_MIN) return 'B';
  if (score >= GRADE_C_MIN) return 'C';
  if (score >= GRADE_D_MIN) return 'D';
  return 'F';
}

function makeDim(name: string, weight: number, rawScore: number, notes: string): DimensionScore {
  return {
    name,
    weight,
    rawScore,
    grade: scoreToGrade(rawScore),
    notes,
    weighted: rawScore * weight,
  };
}

// ── Scoring formulas ──────────────────────────────────────────────────────────

function scoreFriction(record: RunRecord): [number, string] {
  const interruptions = record.toolCalls.filter((tc) => tc.isInterruption).length;
  let s = 100.0;
  s -= interruptions * FRICTION_INTERRUPTION_PENALTY;
  s -= record.providerErrors.length * FRICTION_PROVIDER_ERROR_PENALTY;
  s = Math.max(0, s);

  const intStr = interruptions ? `${interruptions} interruption(s)` : 'zero interruptions';
  const errStr = record.providerErrors.length
    ? `${record.providerErrors.length} provider error(s)`
    : 'zero provider errors';

  return [Math.round(s * 10) / 10, `${intStr}; ${errStr}`];
}

function scoreSpeed(record: RunRecord): [number, string] {
  const activeTime = record.toolCalls.reduce((sum, tc) => sum + (tc.endTime - tc.startTime), 0);
  const wallTime = Math.max(0, record.endTime - record.startTime);
  const docLookups = record.toolCalls.filter((tc) => tc.isDocLookup).length;

  const excess = Math.max(0, activeTime - SPEED_IDEAL_ACTIVE_S);
  const s = Math.max(0, 100.0 - excess * SPEED_DEGRADATION_RATE);
  const notes = `${activeTime.toFixed(0)}s active / ${wallTime.toFixed(0)}s wall; ${
    docLookups === 0 ? 'no' : String(docLookups)
  } doc lookups`;
  return [Math.round(s * 10) / 10, notes];
}

function scoreEfficiency(record: RunRecord): [number, string] {
  const total = record.toolCalls.length;
  if (total === 0) {
    return [100.0, 'N/A (no tools in baseline/skills mode)'];
  }
  const s = Math.min(100.0, (100.0 * EFFICIENCY_IDEAL_CALLS) / Math.max(EFFICIENCY_IDEAL_CALLS, total));

  // Build tool summary
  const counts: Record<string, number> = {};
  for (const tc of record.toolCalls) {
    counts[tc.name] = (counts[tc.name] ?? 0) + 1;
  }
  const summary = formatToolSummary(counts);
  return [Math.round(s * 10) / 10, `${total} tool calls — ${summary}`];
}

function scoreErrors(record: RunRecord): [number, string] {
  const s = Math.max(0, 100.0 - record.providerErrors.length * ERROR_RECOVERY_PENALTY);
  const notes = record.providerErrors.length
    ? record.providerErrors.slice(0, 3).join('; ')
    : 'Zero provider errors. SDK behaved correctly on first use.';
  return [Math.round(s * 10) / 10, notes];
}

function scoreCorrectness(graderResults: GraderResult[]): [number, string] {
  // Exclude L2 (hallucination) and L3 (security) graders — they are scored
  // in their own dedicated dimensions. Including them here would double-count
  // their failures (once in Correctness and again in Hallucination/Security).
  const relevant = graderResults.filter((g) => g.level !== GraderLevel.L2 && g.level !== GraderLevel.L3);
  if (!relevant.length) return [0.0, 'No graders run'];
  const passed = relevant.filter((g) => g.passed).length;
  const total = relevant.length;
  const s = (100.0 * passed) / total;
  return [Math.round(s * 10) / 10, `${passed}/${total} graders passed (${s.toFixed(0)}%)`];
}

function scoreFromGraders(graderResults: GraderResult[], level: GraderLevel, emptyNote: string): [number, string] {
  const relevant = graderResults.filter((g) => g.level === level);
  if (!relevant.length) return [100.0, emptyNote];
  const passed = relevant.filter((g) => g.passed).length;
  const failed = relevant.filter((g) => !g.passed);
  const s = (100.0 * passed) / relevant.length;
  const notes =
    failed.length === 0
      ? `All ${passed} graders passed`
      : failed
          .slice(0, 3)
          .map((g) => g.detail)
          .join('; ') + (failed.length > 3 ? ` (+${failed.length - 3} more)` : '');
  return [Math.round(s * 10) / 10, notes];
}

// ── Public API ────────────────────────────────────────────────────────────────

export function score(record: RunRecord, graderResults?: GraderResult[]): ScoredResult {
  const gr = graderResults ?? [];

  const [frictionScore, frictionNotes] = scoreFriction(record);
  const [speedScore, speedNotes] = scoreSpeed(record);
  const [effScore, effNotes] = scoreEfficiency(record);
  const [errScore, errNotes] = scoreErrors(record);
  const [correctnessScore, correctnessNotes] = scoreCorrectness(gr);
  const [hallucinationScore, hallucinationNotes] = scoreFromGraders(
    gr,
    GraderLevel.L2,
    'No hallucination graders defined',
  );
  const [securityScore, securityNotes] = scoreFromGraders(gr, GraderLevel.L3, 'No security graders defined');

  // Zero out process dimensions when the agent never actually executed.
  // Without this gate, a broken run (0 tool calls) scores 48/50 on process
  // because "no interruptions, fast, efficient" — rewarding failure.
  const hasToolCalls = record.toolCalls.length > 0;

  const dimensions: DimensionScore[] = [
    makeDim(
      'Setup Friction',
      0.14,
      hasToolCalls ? frictionScore : 0,
      hasToolCalls ? frictionNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim(
      'Setup Speed',
      0.14,
      hasToolCalls ? speedScore : 0,
      hasToolCalls ? speedNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim(
      'Efficiency',
      0.14,
      hasToolCalls ? effScore : 0,
      hasToolCalls ? effNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim(
      'Error Recovery',
      0.08,
      hasToolCalls ? errScore : 0,
      hasToolCalls ? errNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim('Correctness', 0.25, correctnessScore, correctnessNotes),
    makeDim('Hallucination', 0.15, hallucinationScore, hallucinationNotes),
    makeDim('Security', 0.1, securityScore, securityNotes),
  ];

  const overall = Math.round(dimensions.reduce((sum, d) => sum + d.weighted, 0) * 10) / 10;

  return {
    runRecord: record,
    dimensions,
    overallScore: overall,
    overallGrade: scoreToGrade(overall),
    graderResults: gr,
    graderPassRate: graderPassRateFn(gr),
  };
}
