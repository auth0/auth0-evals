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
import { analyzeWaste } from './waste.js';

// ── Default scoring constants ────────────────────────────────────────────────

const GRADE_A_MIN = 90;
const GRADE_B_MIN = 75;
const GRADE_C_MIN = 60;
const GRADE_D_MIN = 40;

const FRICTION_INTERRUPTION_PENALTY = 14.0;
const FRICTION_PROVIDER_ERROR_PENALTY = 10.0;

const SPEED_IDEAL_ACTIVE_S = 60.0;
const SPEED_DEGRADATION_RATE = 0.4;

const ERROR_RECOVERY_PENALTY = 20.0;

// ── Docs Quality constants ────────────────────────────────────────────────────

function isDocUrl(url: string, sources: readonly [string, string][]): boolean {
  if (!sources.length) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return sources.some(([host, pathPrefix]) => parsed.hostname === host && parsed.pathname.startsWith(pathPrefix));
  } catch {
    return false;
  }
}

const DOCS_QUALITY_POINTS_VALID_URL = 34;
const DOCS_QUALITY_POINTS_NO_ERROR = 33;
const DOCS_QUALITY_POINTS_NO_REWRITE = 17;
const DOCS_QUALITY_POINTS_L4_CORRECTNESS = 16;


const DEFAULT_WEIGHTS: DimensionWeights = {
  'Setup Friction': 0.12,
  'Setup Speed': 0.12,
  Efficiency: 0.12,
  'Error Recovery': 0.07,
  'Docs Quality': 0.07,
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
  const displayNames = opts?.toolDisplayNames ?? DEFAULT_TOOL_DISPLAY_NAMES;

  const total = record.toolCalls.length;
  if (total === 0) {
    return [100.0, 'N/A (no tools in baseline/skills mode)'];
  }

  const waste = analyzeWaste(record.toolCalls);
  const s = Math.max(0, 100.0 * (1 - waste.wasteCount / total));

  const counts: Record<string, number> = {};
  for (const tc of record.toolCalls) {
    counts[tc.name] = (counts[tc.name] ?? 0) + 1;
  }
  const summary = formatToolSummary(counts, displayNames);

  const wasteParts: string[] = [];
  if (waste.duplicateReads) wasteParts.push(`${waste.duplicateReads} dup read(s)`);
  if (waste.erroredOrRetry) wasteParts.push(`${waste.erroredOrRetry} error/retry`);
  if (waste.overwrittenWrites) wasteParts.push(`${waste.overwrittenWrites} overwritten write(s)`);
  if (waste.interruptions) wasteParts.push(`${waste.interruptions} interruption(s)`);
  const wasteStr = wasteParts.length ? ` [waste: ${wasteParts.join(', ')}]` : ' [no waste detected]';

  return [Math.round(s * 10) / 10, `${total} tool calls — ${summary}${wasteStr}`];
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

function scoreDocsQuality(
  record: RunRecord,
  graderResults: GraderResult[],
  docUrlSources?: readonly [string, string][],
): [number, string] {
  // Only score fetch-style lookups with a real http(s) URL. WebSearch lookups
  // normalise args.url to a query string which is not a fetchable URL and
  // should not be scored (they can't satisfy the allowlist check and would
  // unfairly drag down the average).
  const docCalls = record.toolCalls.filter(
    (tc) => tc.isDocLookup && typeof tc.args['url'] === 'string' && (tc.args['url'] as string).startsWith('http'),
  );

  if (docCalls.length === 0) {
    return [100.0, 'No doc lookups — full marks (training data was sufficient)'];
  }

  const l4Results = graderResults.filter((g) => g.level === GraderLevel.L4);
  const l4PassRate = l4Results.length > 0 ? l4Results.filter((g) => g.passed).length / l4Results.length : 1.0;

  // For the "no rewrite after fetch" signal, build a set of paths written
  // before each doc lookup and check if any of those paths are written again
  // between this lookup and the next (or end of trace).
  const allCalls = record.toolCalls;
  let totalPoints = 0;

  for (let i = 0; i < docCalls.length; i++) {
    const docCall = docCalls[i]!;
    let points = 0;

    // Signal 1: URL is a valid doc domain (+34). Bypassed if no allowlist configured.
    const url = docCall.args['url'] as string;
    if (!docUrlSources?.length || isDocUrl(url, docUrlSources)) points += DOCS_QUALITY_POINTS_VALID_URL;

    // Signal 2: Fetch did not error (+33)
    if (!docCall.causedError) points += DOCS_QUALITY_POINTS_NO_ERROR;

    // Signal 3a: No write_file to an already-written path between this fetch
    // and the next doc fetch (or end of trace) (+17)
    const docCallIdx = allCalls.indexOf(docCall);
    const nextDocCallIdx = i + 1 < docCalls.length ? allCalls.indexOf(docCalls[i + 1]!) : allCalls.length;

    // Collect paths written before this doc lookup
    const pathsWrittenBefore = new Set<string>();
    for (let j = 0; j < docCallIdx; j++) {
      const tc = allCalls[j]!;
      if (tc.name === 'write_file' && typeof tc.args['path'] === 'string') {
        pathsWrittenBefore.add(tc.args['path']);
      }
    }

    let hasRewrite = false;
    for (let j = docCallIdx + 1; j < nextDocCallIdx; j++) {
      const tc = allCalls[j]!;
      if (tc.name === 'write_file' && typeof tc.args['path'] === 'string') {
        if (pathsWrittenBefore.has(tc.args['path'])) {
          hasRewrite = true;
          break;
        }
      }
    }
    if (!hasRewrite) points += DOCS_QUALITY_POINTS_NO_REWRITE;

    // Signal 3b: L4 grader pass rate (+16 scaled)
    points += Math.round(DOCS_QUALITY_POINTS_L4_CORRECTNESS * l4PassRate);

    totalPoints += points;
  }

  const avgScore = totalPoints / docCalls.length;
  const rounded = Math.round(avgScore * 10) / 10;
  const l4Str = l4Results.length > 0 ? `L4 pass rate ${(l4PassRate * 100).toFixed(0)}%` : 'no L4 graders';
  return [rounded, `${docCalls.length} doc lookup(s); ${l4Str}`];
}


// ── Public API ────────────────────────────────────────────────────────────────

export function score(record: RunRecord, graderResults?: GraderResult[], opts?: ScoringOptions): ScoredResult {
  const gr = graderResults ?? [];
  const weights = { ...DEFAULT_WEIGHTS, ...opts?.weights };

  const [frictionScore, frictionNotes] = scoreFriction(record, opts);
  const [speedScore, speedNotes] = scoreSpeed(record, opts);
  const [effScore, effNotes] = scoreEfficiency(record, opts);
  const [errScore, errNotes] = scoreErrors(record, opts);
  const [docsScore, docsNotes] = scoreDocsQuality(record, gr, opts?.docUrlSources);
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
    makeDim(
      'Docs Quality',
      weights['Docs Quality'],
      hasToolCalls ? docsScore : 0,
      hasToolCalls ? docsNotes : 'Agent did not execute (0 tool calls)',
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
