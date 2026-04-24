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
import { logger } from './utils/logger.js';
import { MODES, resultVariant, loadScores, groupResults, groupByVariant, computeDeltas } from './report/processors.js';

// Re-export for backward compatibility with existing consumers and tests.
export { resultVariant, loadScores, groupResults, groupByVariant, computeDeltas } from './report/processors.js';

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
  const modelsRun = [...new Set(results.map((r) => r.model as string))].sort();
  const variantsRun = [...new Set(results.map(resultVariant))];
  const evalsRun = [...new Set(results.map((r) => r.eval_id as string))].sort();

  // Known base modes come first (in MODES order), then any extra variants alphabetically.
  const variantsPresent = [
    ...MODES.filter((m) => variantsRun.includes(m)),
    ...variantsRun.filter((v) => !MODES.includes(v)).sort(),
  ];

  const groupedSortedKeys = Object.keys(grouped).sort();

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
    models_run: modelsRun,
    variants_run: variantsRun,
    variants_present: variantsPresent,
    evals_run: evalsRun,
    generated_at: generatedAt,
    MODES,
  });
}

