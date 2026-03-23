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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { RunRecord } from './agent.js';
import { passRate as graderPassRateFn, type GraderResult } from './graders.js';

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

const HALLUCINATION_PENALTY = 20.0;

const SECURITY_PENALTY_HARDCODED_SECRET = 30.0;
const SECURITY_PENALTY_INSECURE_STORAGE = 20.0;
const SECURITY_PENALTY_EXPOSED_SECRET = 25.0;

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
  const labelMap: Record<string, string> = {
    read_file: 'Read',
    list_files: 'List',
    write_file: 'Write',
    run_command: 'Bash',
    fetch_url: 'Fetch',
    ask_user: 'Ask',
  };
  const summary = Object.entries(counts)
    .map(([n, c]) => `${labelMap[n] ?? n}×${c}`)
    .join(' ');
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

  const fakePatterns: [RegExp, string][] = [
    [/from\s+auth0\s+import\s+Auth0Client/i, "Auth0Client doesn't exist in auth0 package"],
    [/import\s+@auth0\/auth0-sdk/i, "@auth0/auth0-sdk doesn't exist"],
    [/Auth0\.configure\(/i, 'Auth0.configure() not a real method'],
    [/auth0\.loginWithRedirect\(/i, 'Incorrect method name (should be loginWithPopup)'],
  ];

  for (const filePath of walkFiles(workspace)) {
    if (!/\.(js|jsx|ts|tsx|swift|py)$/.test(filePath)) continue;
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fileName = basename(filePath);
      for (const [pattern, description] of fakePatterns) {
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

  const vulnPatterns: [RegExp, string, number][] = [
    [/client_secret\s*[=:]\s*['"][^'"]+['"]/i, 'Hardcoded client_secret', SECURITY_PENALTY_HARDCODED_SECRET],
    [
      /localStorage\.setItem\(['"'].*token/i,
      'Token in localStorage (use secure cookie)',
      SECURITY_PENALTY_INSECURE_STORAGE,
    ],
    [/api_key\s*[=:]\s*['"][^'"]+['"]/i, 'Hardcoded API key', SECURITY_PENALTY_HARDCODED_SECRET],
    [/password\s*[=:]\s*['"][^'"]+['"]/i, 'Hardcoded password', SECURITY_PENALTY_HARDCODED_SECRET],
    [/client_secret.*process\.env/i, 'client_secret exposed in frontend', SECURITY_PENALTY_EXPOSED_SECRET],
  ];

  for (const filePath of walkFiles(workspace)) {
    if (!/\.(js|jsx|ts|tsx|swift|py)$/.test(filePath)) continue;
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fileName = basename(filePath);
      for (const [pattern, description, penalty] of vulnPatterns) {
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

function* walkFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else {
      yield full;
    }
  }
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

  const dimensions: DimensionScore[] = [
    makeDim('Setup Friction', 0.15, frictionScore, frictionNotes),
    makeDim('Setup Speed', 0.1, speedScore, speedNotes),
    makeDim('Efficiency', 0.1, effScore, effNotes),
    makeDim('Error Recovery', 0.05, errScore, errNotes),
    makeDim('Docs Quality', 0.1, docScore, docNotes),
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
