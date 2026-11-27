/**
 * Report rendering engine.
 *
 * Provides `renderHtml()` to generate HTML reports from eval result data.
 */

import { existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import nunjucks from 'nunjucks';
import { registerFilters } from './report-filters.js';
import {
  MODES,
  resultVariant,
  groupResults,
  groupByVariant,
  computeDeltas,
  summariseBySplit,
} from './report/processors.js';

// Re-export for backward compatibility with existing consumers and tests.
export {
  resultVariant,
  loadScores,
  groupResults,
  groupByVariant,
  computeDeltas,
  summariseBySplit,
} from './report/processors.js';
export type { SplitGroup, SplitVariantSummary } from './report/processors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the templates directory. Works from both dist/ and src/.
 */
function resolveTemplatesDir(): string {
  // When running from dist/ the templates are in ../src/templates (source only, not compiled).
  // When running from src/ the templates are in ./templates.
  const fromSrc = join(__dirname, 'templates');
  const fromDist = join(__dirname, '..', 'src', 'templates');
  // Prefer src/templates if it exists (running from source), fall back to dist/../src/templates
  return existsSync(fromSrc) && readdirSync(fromSrc, { withFileTypes: true }).length > 0 ? fromSrc : fromDist;
}

export function renderHtml(results: Record<string, unknown>[], generatedAt: string): string {
  const grouped = groupResults(results);
  const variantGrouped = groupByVariant(results);
  const deltas = computeDeltas(variantGrouped);

  const totalRuns = results.length;
  const totalCost = results.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  const totalJudgeCost = results.reduce((sum, r) => sum + Number(r.judge_cost_usd ?? 0), 0);
  const grandTotalCost = results.reduce((sum, r) => sum + Number(r.total_cost_usd ?? r.cost_usd ?? 0), 0);
  const modelsRun = [...new Set(results.map((r) => r.model as string))].sort();
  const variantsRun = [...new Set(results.map(resultVariant))];
  const evalsRun = [...new Set(results.map((r) => r.eval_id as string))].sort();

  // Known base modes come first (in MODES order), then any extra variants alphabetically.
  const variantsPresent = [
    ...MODES.filter((m) => variantsRun.includes(m)),
    ...variantsRun.filter((v) => !MODES.includes(v)).sort(),
  ];

  const groupedSortedKeys = Object.keys(grouped).sort();

  // Tuning / held-out: only shown when results carry a split (a split file was configured).
  const hasSplits = results.some((r) => r.split === 'tuning' || r.split === 'heldout');
  const splitSummary = summariseBySplit(results);
  const evalSplits: Record<string, string> = {};
  for (const r of results) {
    if (typeof r.split === 'string') evalSplits[r.eval_id as string] = r.split;
  }

  const env = nunjucks.configure(resolveTemplatesDir(), {
    autoescape: true,
    noCache: true,
  });
  registerFilters(env);

  return nunjucks.render('report.html.j2', {
    grouped,
    grouped_sorted_keys: groupedSortedKeys,
    variant_grouped: variantGrouped,
    deltas,
    total_runs: totalRuns,
    total_cost: totalCost,
    total_judge_cost: totalJudgeCost,
    grand_total_cost: grandTotalCost,
    models_run: modelsRun,
    variants_run: variantsRun,
    variants_present: variantsPresent,
    evals_run: evalsRun,
    generated_at: generatedAt,
    has_splits: hasSplits,
    split_summary: splitSummary,
    eval_splits: evalSplits,
    MODES,
  });
}
