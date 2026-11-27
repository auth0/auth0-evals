import { readFileSync } from 'node:fs';

/** Known base modes in display order. */
export const MODES = ['baseline', 'agent'];

/**
 * Returns a stable string that identifies a result's mode+tools combination.
 * Baseline and no-tool agent runs are keyed by mode alone; agent runs with
 * tools append them: "agent+Skills" or "agent+Skills,MCP".
 */
export function resultVariant(r: Record<string, unknown>): string {
  const mode = r.mode as string;
  const tools = (r.tools as string[] | undefined) ?? [];
  return tools.length > 0 ? `${mode}+${tools.join(',')}` : mode;
}

/** The three groups a result can fall into: its split, or `unlabelled` when it has none. */
export type SplitGroup = 'tuning' | 'heldout' | 'unlabelled';

/** Runs and mean grader pass rate for one variant within one split group. */
export interface SplitVariantSummary {
  /** Every result in the group, including errors. */
  runs: number;
  /** Mean `grader_pass_rate` of graded results; `null` when none were graded. */
  meanPassRate: number | null;
}

/**
 * Summarises results per split group and variant (mode+tools). Tuning and held-out
 * results are never blended into one number. Error results count as runs but not in
 * the mean, since they have no pass rate.
 */
export function summariseBySplit(
  results: Record<string, unknown>[],
): Record<SplitGroup, Record<string, SplitVariantSummary>> {
  const sums: Record<SplitGroup, Record<string, { runs: number; total: number; graded: number }>> = {
    tuning: {},
    heldout: {},
    unlabelled: {},
  };
  for (const r of results) {
    const group: SplitGroup = r.split === 'tuning' || r.split === 'heldout' ? r.split : 'unlabelled';
    const variant = resultVariant(r);
    const acc = (sums[group][variant] ??= { runs: 0, total: 0, graded: 0 });
    acc.runs++;
    if (r.status !== 'error' && typeof r.grader_pass_rate === 'number') {
      acc.total += r.grader_pass_rate;
      acc.graded++;
    }
  }
  const out: Record<SplitGroup, Record<string, SplitVariantSummary>> = { tuning: {}, heldout: {}, unlabelled: {} };
  for (const group of Object.keys(sums) as SplitGroup[]) {
    for (const [variant, acc] of Object.entries(sums[group])) {
      out[group][variant] = { runs: acc.runs, meanPassRate: acc.graded > 0 ? acc.total / acc.graded : null };
    }
  }
  return out;
}

export function loadScores(paths: string[]): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  for (const p of paths) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(p, 'utf-8'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse scores file ${p}: ${message}`, { cause: err });
    }
    if (!Array.isArray(data)) {
      throw new Error(`Scores file ${p} must contain a JSON array, got ${typeof data}`);
    }
    results.push(...(data as Record<string, unknown>[]));
  }
  return results;
}

export function groupResults(
  results: Record<string, unknown>[],
): Record<string, Record<string, Record<string, unknown>>> {
  const grouped: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const r of results) {
    const eid = r.eval_id as string;
    const key = `${r.model as string}|${resultVariant(r)}`;
    if (!grouped[eid]) grouped[eid] = {};
    grouped[eid][key] = r;
  }
  return grouped;
}

/**
 * Group results by variant (mode+tools) -> eval_id -> model -> result.
 * Each distinct tool configuration produces a separate top-level key, so
 * agent runs with different --tools values are never conflated.
 */
export function groupByVariant(
  results: Record<string, unknown>[],
): Record<string, Record<string, Record<string, Record<string, unknown>>>> {
  const variantGrouped: Record<string, Record<string, Record<string, Record<string, unknown>>>> = {};
  for (const r of results) {
    const variant = resultVariant(r);
    const eid = r.eval_id as string;
    const model = r.model as string;
    if (!variantGrouped[variant]) variantGrouped[variant] = {};
    if (!variantGrouped[variant][eid]) variantGrouped[variant][eid] = {};
    variantGrouped[variant][eid][model] = r;
  }
  return variantGrouped;
}

/** Compute grader_pass_rate delta vs baseline for every non-baseline variant. */
export function computeDeltas(
  variantGrouped: Record<string, Record<string, Record<string, Record<string, unknown>>>>,
): Record<string, Record<string, Record<string, number | null>>> {
  const deltas: Record<string, Record<string, Record<string, number | null>>> = {};
  const baseline = variantGrouped['baseline'] ?? {};
  for (const variant of Object.keys(variantGrouped)) {
    if (variant === 'baseline') continue;
    deltas[variant] = {};
    const variantData = variantGrouped[variant] ?? {};
    for (const [eid, models] of Object.entries(variantData)) {
      deltas[variant][eid] = {};
      for (const [model, result] of Object.entries(models)) {
        const baseResult = baseline[eid]?.[model];
        const rate = result.grader_pass_rate as number | undefined;
        const baseRate = baseResult?.grader_pass_rate as number | undefined;
        if (rate != null && baseRate != null) {
          deltas[variant][eid][model] = rate - baseRate;
        } else {
          deltas[variant][eid][model] = null;
        }
      }
    }
  }
  return deltas;
}
