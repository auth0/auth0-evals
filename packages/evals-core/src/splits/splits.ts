/**
 * Loads, validates and applies the tuning / held-out split file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EvalConfigError } from '../errors.js';
import type { EvalConfig } from '../loader.js';
import type { EvalSplit, SplitFile } from './types.js';

const SPLITS: readonly EvalSplit[] = ['tuning', 'heldout'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A held-out family needs at least this many evals to give a meaningful result. */
export const MIN_HELDOUT_EVALS = 3;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Reads and parses a split file, checking only its shape. Rules that depend on
 * the discovered evals live in {@link validateSplitFile}.
 *
 * @throws {EvalConfigError} When the file is missing, is not JSON, or has the wrong shape.
 */
export function loadSplitFile(absPath: string): SplitFile {
  if (!existsSync(absPath)) {
    throw new EvalConfigError('Split file not found', absPath);
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(absPath, 'utf-8'));
  } catch (e) {
    throw new EvalConfigError(`Split file is not valid JSON (${(e as Error).message})`, absPath);
  }
  if (!isRecord(data) || !isRecord(data.families) || !Array.isArray(data.pairs) || !Array.isArray(data.history)) {
    throw new EvalConfigError(
      'Split file must have "families" (object), "pairs" (array) and "history" (array)',
      absPath,
    );
  }
  for (const pair of data.pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((f) => typeof f !== 'string')) {
      throw new EvalConfigError('Each entry in "pairs" must be two family names', absPath);
    }
  }
  for (const entry of data.history) {
    if (!isRecord(entry) || typeof entry.date !== 'string' || !Array.isArray(entry.heldout)) {
      throw new EvalConfigError('Each entry in "history" must have "date" (string) and "heldout" (array)', absPath);
    }
  }
  return data as unknown as SplitFile;
}

/**
 * Checks a split file against the discovered evals.
 *
 * @throws {EvalConfigError} Naming the offending family and `filePath`, when a rule is broken.
 */
export function validateSplitFile(file: SplitFile, evals: EvalConfig[], filePath: string): void {
  const counts = new Map<string, number>();
  for (const cfg of evals) counts.set(cfg.category, (counts.get(cfg.category) ?? 0) + 1);

  for (const family of [...counts.keys()].sort()) {
    if (!(family in file.families)) {
      throw new EvalConfigError(
        `Eval family "${family}" has no split label. Add it to the split file; new families start as "tuning"`,
        filePath,
      );
    }
  }

  for (const [family, split] of Object.entries(file.families)) {
    if (!counts.has(family)) {
      throw new EvalConfigError(`Split file lists unknown family "${family}" (no eval has this category)`, filePath);
    }
    if (!SPLITS.includes(split)) {
      throw new EvalConfigError(`Family "${family}" has split "${split}"; expected "tuning" or "heldout"`, filePath);
    }
    if (split === 'heldout' && (counts.get(family) ?? 0) < MIN_HELDOUT_EVALS) {
      throw new EvalConfigError(
        `Held-out family "${family}" has ${counts.get(family)} eval(s); a held-out family needs at least ${MIN_HELDOUT_EVALS}`,
        filePath,
      );
    }
  }

  const paired = new Set<string>();
  for (const [a, b] of file.pairs) {
    for (const family of [a, b]) {
      if (!(family in file.families)) {
        throw new EvalConfigError(
          `Pair [${a}, ${b}] names family "${family}", which the split file does not list`,
          filePath,
        );
      }
      if (paired.has(family)) {
        throw new EvalConfigError(`Family "${family}" appears in more than one pair`, filePath);
      }
      paired.add(family);
    }
    if (file.families[a] === file.families[b]) {
      throw new EvalConfigError(
        `Pair [${a}, ${b}] has both families on "${file.families[a]}"; one must be tuning and one held out`,
        filePath,
      );
    }
  }

  for (const entry of file.history) {
    if (!DATE_RE.test(entry.date)) {
      throw new EvalConfigError(`History date "${entry.date}" must be YYYY-MM-DD`, filePath);
    }
  }

  const current = Object.entries(file.families)
    .filter(([, split]) => split === 'heldout')
    .map(([family]) => family)
    .sort();
  const last = file.history.at(-1);
  const recorded = last ? [...last.heldout].sort() : [];
  if (!last || recorded.join(',') !== current.join(',')) {
    throw new EvalConfigError(
      `Split history is out of date: the last entry holds out [${recorded.join(', ')}] but the current ` +
        `held-out families are [${current.join(', ')}]. Add a history entry when the split changes`,
      filePath,
    );
  }
}

/** Returns copies of `evals` with `split` set from their family's label. */
export function applySplits(evals: EvalConfig[], file: SplitFile): EvalConfig[] {
  return evals.map((cfg) => {
    const split = file.families[cfg.category];
    return split ? { ...cfg, split } : { ...cfg };
  });
}

/**
 * Loads, validates and applies the split file named by the framework config.
 * Returns `evals` unchanged when no split file is configured (`splitsFile` is `''`).
 *
 * @param splitsFile - Path relative to `frameworkRoot`, e.g. `'eval-splits.json'`.
 * @throws {EvalConfigError} When the file is missing or invalid.
 */
export function loadSplitsForEvals(evals: EvalConfig[], frameworkRoot: string, splitsFile: string): EvalConfig[] {
  if (!splitsFile) return evals;
  const absPath = join(frameworkRoot, splitsFile);
  const file = loadSplitFile(absPath);
  validateSplitFile(file, evals, absPath);
  return applySplits(evals, file);
}
