#!/usr/bin/env node
/**
 * Report generator.
 *
 * Reads scores-*.json files and produces a single HTML report.
 *
 * Usage:
 *   node dist/report.js                        # auto-discovers scores-*.json
 *   node dist/report.js --input scores-baseline.json scores-skills.json
 *   node dist/report.js --output my-report.html
 */

import { writeFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import nunjucks from 'nunjucks';
import { registerFilters } from './report-filters.js';
import { logger } from './utils/logger.js';
import { MODES, resultVariant, loadScores, groupResults, groupByVariant, computeDeltas } from './report/processors.js';

// Re-export for backward compatibility with existing consumers and tests.
export { resultVariant, loadScores, groupResults, groupByVariant, computeDeltas } from './report/processors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// When running from dist/ or src/, go up one level to reach the project root.
const FRAMEWORK_ROOT = ['dist', 'src'].includes(basename(__dirname)) ? join(__dirname, '..') : __dirname;

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

  const env = nunjucks.configure(join(FRAMEWORK_ROOT, 'src', 'templates'), {
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

async function main(): Promise<void> {
  const program = new Command();
  program
    .description('Generate eval HTML report')
    .option('--input <files...>', 'Score JSON files (default: auto-discover scores-*.json)')
    .option('--output <path>', 'Output HTML path (default: report.html)', 'report.html');

  program.parse(process.argv);
  const opts = program.opts();

  let inputFiles: string[] = (opts.input as string[] | undefined) ?? [];
  if (inputFiles.length === 0) {
    inputFiles = readdirSync(FRAMEWORK_ROOT)
      .filter((f) => /^scores-.*\.json$/.test(f))
      .map((f) => join(FRAMEWORK_ROOT, f))
      .sort();
  }

  if (inputFiles.length === 0) {
    logger.error('No scores-*.json files found. Run `node dist/run.js` first.');
    process.exit(1);
  }

  logger.info(`Loading: ${JSON.stringify(inputFiles)}`);
  const results = loadScores(inputFiles);
  const evalCount = new Set(results.map((r) => r.eval_id)).size;
  logger.info(`  ${results.length} result(s) across ${evalCount} eval(s)`);

  const now = new Date();
  const generatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const html = renderHtml(results, generatedAt);
  const outputPath = join(FRAMEWORK_ROOT, opts.output as string);
  writeFileSync(outputPath, html, 'utf-8');
  logger.info(`Report saved to: ${outputPath}`);

  const consolidatedPath = join(FRAMEWORK_ROOT, 'scores-consolidated.json');
  writeFileSync(consolidatedPath, JSON.stringify(results, null, 2), 'utf-8');
  logger.info(`Consolidated JSON saved to: ${consolidatedPath}`);
}

// Skip main() when running under Vitest (process.env.VITEST is set automatically)
if (!process.env.VITEST) {
  main().catch((e) => {
    logger.error(e);
    process.exit(1);
  });
}
