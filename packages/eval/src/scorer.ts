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

import type {
  RunRecord,
  GraderResult,
  DimensionScore,
  ScoredResult,
  ScoringOptions,
  DimensionWeights,
} from '@a0/eval-core';
import { GraderLevel } from '@a0/eval-core';

// ── Default scoring constants ────────────────────────────────────────────────

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

const DEFAULT_WEIGHTS: DimensionWeights = {
  'Setup Friction': 0.14,
  'Setup Speed': 0.14,
  Efficiency: 0.14,
  'Error Recovery': 0.08,
  Correctness: 0.25,
  Hallucination: 0.15,
  Security: 0.1,
};

const DEFAULT_TOOL_DISPLAY_NAMES: Record<string, string> = {
  read_file: 'Read',
  list_files: 'List',
  write_file: 'Write',
  run_command: 'Bash',
  fetch_url: 'Fetch',
  ask_user: 'Ask',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function passRate(results: GraderResult[]): number {
  if (!results.length) return 0.0;
  return results.filter((r) => r.passed).length / results.length;
}

function formatToolSummary(counts: Record<string, number>, displayNames: Record<string, string>): string {
  return Object.entries(counts)
    .map(([n, c]) => `${displayNames[n] ?? n}×${c}`)
    .join(' ');
}

// ── Grade thresholds ──────────────────────────────────────────────────────────

export function scoreToGrade(s: number): string {
  if (s >= GRADE_A_MIN) return 'A';
  if (s >= GRADE_B_MIN) return 'B';
  if (s >= GRADE_C_MIN) return 'C';
  if (s >= GRADE_D_MIN) return 'D';
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

function scoreFriction(record: RunRecord, opts?: ScoringOptions): [number, string] {
  const intPenalty = opts?.frictionInterruptionPenalty ?? FRICTION_INTERRUPTION_PENALTY;
  const errPenalty = opts?.frictionProviderErrorPenalty ?? FRICTION_PROVIDER_ERROR_PENALTY;

  const interruptions = record.toolCalls.filter((tc) => tc.isInterruption).length;
  let s = 100.0;
  s -= interruptions * intPenalty;
  s -= record.providerErrors.length * errPenalty;
  s = Math.max(0, s);

  const intStr = interruptions ? `${interruptions} interruption(s)` : 'zero interruptions';
  const errStr = record.providerErrors.length
    ? `${record.providerErrors.length} provider error(s)`
    : 'zero provider errors';

  return [Math.round(s * 10) / 10, `${intStr}; ${errStr}`];
}

function scoreSpeed(record: RunRecord, opts?: ScoringOptions): [number, string] {
  const ideal = opts?.speedIdealActiveS ?? SPEED_IDEAL_ACTIVE_S;
  const rate = opts?.speedDegradationRate ?? SPEED_DEGRADATION_RATE;

  const activeTime = record.toolCalls.reduce((sum, tc) => sum + (tc.endTime - tc.startTime), 0);
  const wallTime = Math.max(0, record.endTime - record.startTime);
  const docLookups = record.toolCalls.filter((tc) => tc.isDocLookup).length;

  const excess = Math.max(0, activeTime - ideal);
  const s = Math.max(0, 100.0 - excess * rate);
  const notes = `${activeTime.toFixed(0)}s active / ${wallTime.toFixed(0)}s wall; ${
    docLookups === 0 ? 'no' : String(docLookups)
  } doc lookups`;
  return [Math.round(s * 10) / 10, notes];
}

function scoreEfficiency(record: RunRecord, opts?: ScoringOptions): [number, string] {
  const idealCalls = opts?.efficiencyIdealCalls ?? EFFICIENCY_IDEAL_CALLS;
  const displayNames = opts?.toolDisplayNames ?? DEFAULT_TOOL_DISPLAY_NAMES;

  const total = record.toolCalls.length;
  if (total === 0) {
    return [100.0, 'N/A (no tools in baseline/skills mode)'];
  }
  const s = Math.min(100.0, (100.0 * idealCalls) / Math.max(idealCalls, total));

  // Build tool summary
  const counts: Record<string, number> = {};
  for (const tc of record.toolCalls) {
    counts[tc.name] = (counts[tc.name] ?? 0) + 1;
  }
  const summary = formatToolSummary(counts, displayNames);
  return [Math.round(s * 10) / 10, `${total} tool calls — ${summary}`];
}

function scoreErrors(record: RunRecord, opts?: ScoringOptions): [number, string] {
  const penalty = opts?.errorRecoveryPenalty ?? ERROR_RECOVERY_PENALTY;

  const s = Math.max(0, 100.0 - record.providerErrors.length * penalty);
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

export function score(record: RunRecord, graderResults?: GraderResult[], opts?: ScoringOptions): ScoredResult {
  const gr = graderResults ?? [];
  const weights = { ...DEFAULT_WEIGHTS, ...opts?.weights };

  const [frictionScore, frictionNotes] = scoreFriction(record, opts);
  const [speedScore, speedNotes] = scoreSpeed(record, opts);
  const [effScore, effNotes] = scoreEfficiency(record, opts);
  const [errScore, errNotes] = scoreErrors(record, opts);
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
      weights['Setup Friction'],
      hasToolCalls ? frictionScore : 0,
      hasToolCalls ? frictionNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim(
      'Setup Speed',
      weights['Setup Speed'],
      hasToolCalls ? speedScore : 0,
      hasToolCalls ? speedNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim(
      'Efficiency',
      weights['Efficiency'],
      hasToolCalls ? effScore : 0,
      hasToolCalls ? effNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim(
      'Error Recovery',
      weights['Error Recovery'],
      hasToolCalls ? errScore : 0,
      hasToolCalls ? errNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim('Correctness', weights['Correctness'], correctnessScore, correctnessNotes),
    makeDim('Hallucination', weights['Hallucination'], hallucinationScore, hallucinationNotes),
    makeDim('Security', weights['Security'], securityScore, securityNotes),
  ];

  const overall = Math.round(dimensions.reduce((sum, d) => sum + d.weighted, 0) * 10) / 10;

  return {
    runRecord: record,
    dimensions,
    overallScore: overall,
    overallGrade: scoreToGrade(overall),
    graderResults: gr,
    graderPassRate: passRate(gr),
  };
}
