/**
 * Result persistence — load, save, deduplicate and merge eval results.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import {
  ALL_MODES,
  type Mode,
  type JobResult,
  type AgentJobResult,
  type BaselineJobResult,
  type ErrorJobResult,
  type DimensionSummary,
} from '@a0/evals-core';
import { scoreToGrade } from '../scorer.js';

/**
 * Returns a stable string key that uniquely identifies a job within a results file.
 *
 * The key is `eval_id|model|mode|tools` where `tools` is a sorted, deduplicated,
 * comma-joined list. Baseline results (which carry no `tools` field) use an empty
 * string for the tools segment.
 */
export function resultKey(result: JobResult): string {
  // Access tools as unknown so the Array.isArray guard is meaningful at runtime,
  // even when a value loaded from disk violates the TypeScript type (e.g. null or string).
  const rawTools = 'tools' in result ? (result as { tools: unknown }).tools : undefined;
  const tools = Array.isArray(rawTools) ? (rawTools as string[]) : [];
  const normalised = Array.from(new Set(tools)).sort();
  return `${result.eval_id}|${result.model}|${result.mode}|${normalised.join(',')}`;
}

/**
 * Merges a batch of incoming results into an existing array, replacing any
 * entry whose key matches a new result.
 *
 * Within `incoming`, duplicate keys are resolved by keeping the last value
 * (i.e. later entries win). Entries in `existing` whose key does not appear
 * in `incoming` are preserved unchanged.
 *
 * @param existing - Previously persisted results (may be empty).
 * @param incoming - Fresh results from the current run.
 */
export function mergeResults(existing: JobResult[], incoming: JobResult[]): JobResult[] {
  const deduped = Object.values(Object.fromEntries(incoming.map((r) => [resultKey(r), r])));
  const newKeys = new Set(deduped.map(resultKey));
  return [...existing.filter((r) => !newKeys.has(resultKey(r))), ...deduped];
}

/**
 * Reads and parses a results JSON file, returning only well-formed entries
 * as `JobResult[]`.
 *
 * Four fields are structurally validated at load time:
 * - `eval_id` and `model` must be strings
 * - `mode` must be `'baseline'` or `'agent'`
 * - `tools` (if present) must be an array of strings
 *
 * Returns an empty array if the file does not exist or cannot be parsed.
 *
 * @param path - Absolute path to the JSON results file.
 */
export function loadResults(path: string): JobResult[] {
  if (!existsSync(path)) return [];
  try {
    const loaded = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (Array.isArray(loaded)) {
      return (loaded as JobResult[]).filter((r) => {
        if (typeof r !== 'object' || r === null) return false;
        const rec = r as unknown as Record<string, unknown>;
        if (typeof rec.eval_id !== 'string' || typeof rec.model !== 'string') return false;
        if (!ALL_MODES.includes(rec.mode as Mode)) return false;
        if ('tools' in rec) {
          if (!Array.isArray(rec.tools)) return false;
          if (!(rec.tools as unknown[]).every((t) => typeof t === 'string')) return false;
        }
        return true;
      });
    }
  } catch {
    // ignore corrupt file
  }
  return [];
}

/**
 * Serialises `results` to a pretty-printed JSON file at `path`.
 *
 * @param path - Absolute path to write.
 * @param results - Array of job results to persist.
 */
export function saveResults(path: string, results: JobResult[]): void {
  writeFileSync(path, JSON.stringify(results, null, 2), 'utf-8');
}

/**
 * Resolves the absolute output file path for a run.
 *
 * Uses `override` when supplied; otherwise derives a default name from the
 * set of modes: a single mode produces `scores-<mode>.json`, while multiple
 * modes produce `scores-all-modes.json`.
 *
 * The resolved path is always guaranteed to be inside `frameworkRoot`.
 * Absolute paths and `..`-traversal in `override` are rejected with an error,
 * preventing results from being written outside the project directory.
 *
 * @param frameworkRoot - Absolute path to the repository root.
 * @param modes - Execution modes that were run (e.g. `["baseline"]`).
 * @param override - Optional caller-supplied relative path from `--output`.
 * @throws {Error} If the resolved path would escape `frameworkRoot`.
 */
export function resolveOutputPath(frameworkRoot: string, modes: string[], override?: string): string {
  const name = override ?? (modes.length > 1 ? 'scores-all-modes.json' : `scores-${modes[0]}.json`);
  const resolved = resolve(frameworkRoot, name);
  const rel = relative(frameworkRoot, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`--output path "${override}" must be relative and must not escape the project root`);
  }
  return resolved;
}

/** Returns the median of a sorted numeric array. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Aggregates a group of agent results into a single representative result using median scores and summed costs. */
function medianAgentResult(group: AgentJobResult[]): AgentJobResult {
  const sorted = [...group].sort((a, b) => a.overall_score - b.overall_score);
  const mid = Math.floor(sorted.length / 2);
  const rep = sorted[mid]!;

  const medianOverallScore = median(group.map((r) => r.overall_score));

  const dimensions: DimensionSummary[] = rep.dimensions.map((dim, i) => {
    const score = median(group.map((r) => r.dimensions[i]!.score));
    return { ...dim, score, weighted: score * dim.weight, grade: scoreToGrade(score) };
  });

  return {
    ...rep,
    overall_score: medianOverallScore,
    overall_grade: scoreToGrade(medianOverallScore),
    grader_pass_rate: median(group.map((r) => r.grader_pass_rate)),
    wall_time: median(group.map((r) => r.wall_time)),
    active_time: median(group.map((r) => r.active_time)),
    tool_calls: Math.round(median(group.map((r) => r.tool_calls))),
    interruptions: Math.round(median(group.map((r) => r.interruptions))),
    tokens: group.reduce((sum, r) => sum + r.tokens, 0),
    cost_usd: group.reduce((sum, r) => sum + r.cost_usd, 0),
    judge_cost_usd: group.reduce((sum, r) => sum + r.judge_cost_usd, 0),
    total_cost_usd: group.reduce((sum, r) => sum + r.total_cost_usd, 0),
    dimensions,
    run_count: group.length,
    runs: group,
  };
}

/** Aggregates a group of baseline results into a single representative result using median scores and summed costs. */
function medianBaselineResult(group: BaselineJobResult[]): BaselineJobResult {
  const sorted = [...group].sort((a, b) => a.grader_pass_rate - b.grader_pass_rate);
  const mid = Math.floor(sorted.length / 2);
  const rep = sorted[mid]!;

  return {
    ...rep,
    graders_passed: Math.round(median(group.map((r) => r.graders_passed))),
    grader_pass_rate: Math.round(median(group.map((r) => r.graders_passed))) / rep.graders_total,
    wall_time: median(group.map((r) => r.wall_time)),
    tokens: group.reduce((sum, r) => sum + r.tokens, 0),
    cost_usd: group.reduce((sum, r) => sum + r.cost_usd, 0),
    judge_cost_usd: group.reduce((sum, r) => sum + r.judge_cost_usd, 0),
    total_cost_usd: group.reduce((sum, r) => sum + r.total_cost_usd, 0),
    run_count: group.length,
    runs: group,
  };
}

/**
 * Aggregates multiple runs of the same job into a single result using median scoring.
 *
 * Groups results by `resultKey` (eval_id|model|mode|tools). For each group:
 * - Size 1: passed through unchanged.
 * - All errors: the last error result is kept as-is.
 * - Otherwise: error results are dropped and the non-errors are aggregated.
 *   Scores are medianed; costs and tokens are summed. The raw runs are
 *   embedded in the `runs` field and `run_count` is set to the group size.
 */
export function aggregateRuns(results: JobResult[]): JobResult[] {
  const groups = new Map<string, JobResult[]>();
  for (const r of results) {
    const key = resultKey(r);
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }

  const aggregated: JobResult[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      aggregated.push(group[0]!);
      continue;
    }

    const nonErrors = group.filter((r) => r.status !== 'error');
    if (nonErrors.length === 0) {
      // All errored — keep last error result
      aggregated.push(group[group.length - 1]!);
      continue;
    }

    const rep = nonErrors[0]!;
    if (rep.mode === 'agent') {
      aggregated.push(medianAgentResult(nonErrors as AgentJobResult[]));
    } else {
      aggregated.push(medianBaselineResult(nonErrors as BaselineJobResult[]));
    }
  }
  return aggregated;
}
