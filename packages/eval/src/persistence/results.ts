/**
 * Result persistence — load, save, deduplicate and merge eval results.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { ALL_MODES, type Mode, type JobResult } from '@a0/eval-core';

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
