/**
 * 8-dimension scorer.
 *
 * Process dimensions (50%): Setup Friction (15%), Setup Speed (10%), Efficiency (10%),
 * Error Recovery (5%), Docs Quality (10%)
 *
 * Output dimensions (50%): Correctness (25%), Hallucination (15%), Security (10%)
 *
 * Each dimension is scored 0–100 and maps to a letter grade.
 * Overall score = weighted sum across all 8 dimensions.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { RunRecord } from './agent-types.js';
import { passRate as graderPassRateFn, walkFiles, type GraderResult } from './graders.js';
import { formatToolSummary } from './tool-display-names.js';
import { FAKE_API_PATTERNS, CREDENTIAL_PATTERNS, HALLUCINATION_PENALTY } from './vulnerability-patterns.js';

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

const DOCS_FEATURE_POINTS = 20.0;


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
  docFeatures: Record<string, boolean>;
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

function scoreDocs(docFeatures: Record<string, boolean>): [number, string] {
  const presentCount = Object.values(docFeatures).filter(Boolean).length;
  const s = Math.min(100.0, presentCount * DOCS_FEATURE_POINTS);
  const present = Object.entries(docFeatures)
    .filter(([, v]) => v)
    .map(([k]) => k);
  const missing = Object.entries(docFeatures)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  const notes =
    `${present.length}/${Object.keys(docFeatures).length} AI discoverability: ${present.join(', ') || 'none'}. ` +
    `Missing: ${missing.join(', ') || 'none'}.`;
  return [Math.round(s * 10) / 10, notes];
}

function scoreCorrectness(graderResults: GraderResult[]): [number, string] {
  if (!graderResults.length) return [0.0, 'No graders run'];
  const passed = graderResults.filter((g) => g.passed).length;
  const total = graderResults.length;
  const s = (100.0 * passed) / total;
  return [Math.round(s * 10) / 10, `${passed}/${total} graders passed (${s.toFixed(0)}%)`];
}

function scoreHallucination(workspace: string): [number, string] {
  let s = 100.0;
  const issues: string[] = [];

  for (const filePath of walkFiles(workspace)) {
    if (!/\.(js|jsx|ts|tsx|swift|py)$/.test(filePath)) continue;
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fileName = basename(filePath);
      for (const [pattern, description] of FAKE_API_PATTERNS) {
        if (pattern.test(content)) {
          issues.push(`${fileName}: ${description}`);
          s -= HALLUCINATION_PENALTY;
        }
      }
    } catch {
      // skip
    }
  }

  s = Math.max(0, s);
  let notes: string;
  if (!issues.length) {
    notes = 'No hallucinations detected';
  } else {
    notes = issues.slice(0, 3).join('; ');
    if (issues.length > 3) notes += ` (+${issues.length - 3} more)`;
  }
  return [Math.round(s * 10) / 10, notes];
}

function scoreSecurity(workspace: string): [number, string] {
  let s = 100.0;
  const issues: string[] = [];

  for (const filePath of walkFiles(workspace)) {
    if (!/\.(js|jsx|ts|tsx|swift|py)$/.test(filePath)) continue;
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fileName = basename(filePath);
      for (const [pattern, description, penalty] of CREDENTIAL_PATTERNS) {
        if (pattern.test(content)) {
          issues.push(`${fileName}: ${description}`);
          s -= penalty;
        }
      }
    } catch {
      // skip
    }
  }

  s = Math.max(0, s);
  let notes: string;
  if (!issues.length) {
    notes = 'No security vulnerabilities detected';
  } else {
    notes = issues.slice(0, 3).join('; ');
    if (issues.length > 3) notes += ` (+${issues.length - 3} more)`;
  }
  return [Math.round(s * 10) / 10, notes];
}

// ── Public API ────────────────────────────────────────────────────────────────

export const AUTH0_SWIFT_DOC_FEATURES: Record<string, boolean> = {
  llms_txt: true,
  context7: true,
  mcp_server: true,
  typed_sdk: true,
  openapi_spec: false,
};

export function score(
  record: RunRecord,
  docFeatures?: Record<string, boolean>,
  graderResults?: GraderResult[],
): ScoredResult {
  const df = docFeatures ?? AUTH0_SWIFT_DOC_FEATURES;
  const gr = graderResults ?? [];

  const [frictionScore, frictionNotes] = scoreFriction(record);
  const [speedScore, speedNotes] = scoreSpeed(record);
  const [effScore, effNotes] = scoreEfficiency(record);
  const [errScore, errNotes] = scoreErrors(record);
  const [docScore, docNotes] = scoreDocs(df);
  const [correctnessScore, correctnessNotes] = scoreCorrectness(gr);
  const [hallucinationScore, hallucinationNotes] = scoreHallucination(record.workspace);
  const [securityScore, securityNotes] = scoreSecurity(record.workspace);

  // Zero out process dimensions when the agent never actually executed.
  // Without this gate, a broken run (0 tool calls) scores 48/50 on process
  // because "no interruptions, fast, efficient" — rewarding failure.
  const hasToolCalls = record.toolCalls.length > 0;

  const dimensions: DimensionScore[] = [
    makeDim(
      'Setup Friction',
      0.15,
      hasToolCalls ? frictionScore : 0,
      hasToolCalls ? frictionNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim(
      'Setup Speed',
      0.1,
      hasToolCalls ? speedScore : 0,
      hasToolCalls ? speedNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim(
      'Efficiency',
      0.1,
      hasToolCalls ? effScore : 0,
      hasToolCalls ? effNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim(
      'Error Recovery',
      0.05,
      hasToolCalls ? errScore : 0,
      hasToolCalls ? errNotes : 'Agent did not execute (0 tool calls)',
    ),
    makeDim(
      'Docs Quality',
      0.1,
      hasToolCalls ? docScore : 0,
      hasToolCalls ? docNotes : 'Agent did not execute (0 tool calls)',
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
    docFeatures: df,
    graderResults: gr,
    graderPassRate: graderPassRateFn(gr),
  };
}
