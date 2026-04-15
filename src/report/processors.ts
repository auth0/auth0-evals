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

export function loadScores(paths: string[]): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  for (const p of paths) {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>[];
    results.push(...data);
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
