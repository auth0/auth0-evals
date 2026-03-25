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

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import nunjucks from 'nunjucks';
import { ALL_FILTERS } from './report-filters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// When running from dist/ or src/, go up one level to reach the project root.
const FRAMEWORK_ROOT = ['dist', 'src'].includes(basename(__dirname)) ? join(__dirname, '..') : __dirname;

const MODES = ['baseline', 'agent'];

// Returns a stable string that identifies a result's mode+tools combination.
// Baseline and no-tool agent runs are keyed by mode alone; agent runs with
// tools append them: "agent+Skills" or "agent+Skills,MCP".
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

// Group results by variant (mode+tools) -> eval_id -> model -> result.
// Each distinct tool configuration produces a separate top-level key, so
// agent runs with different --tools values are never conflated.
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

// Compute grader_pass_rate delta vs baseline for every non-baseline variant.
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

  // Sort result keys for the detail section: baseline < agent < agent+* (then by model).
  function sortResultKeys(keys: string[]): string[] {
    return [...keys].sort((a, b) => {
      const [aModel, aVariant] = a.split('|');
      const [bModel, bVariant] = b.split('|');
      const aModeIdx = MODES.indexOf(aVariant) !== -1 ? MODES.indexOf(aVariant) : 99;
      const bModeIdx = MODES.indexOf(bVariant) !== -1 ? MODES.indexOf(bVariant) : 99;
      if (aModeIdx !== bModeIdx) return aModeIdx - bModeIdx;
      if (aVariant !== bVariant) return aVariant.localeCompare(bVariant);
      return aModel.localeCompare(bModel);
    });
  }
  const groupedSortedKeys = Object.keys(grouped).sort();

  const env = nunjucks.configure(join(FRAMEWORK_ROOT, 'src', 'templates'), {
    autoescape: true,
    noCache: true,
  });
  for (const [name, fn] of Object.entries(ALL_FILTERS)) {
    env.addFilter(name, fn);
  }
  env.addFilter('sort_result_keys', (obj: Record<string, unknown>) => sortResultKeys(Object.keys(obj)));
  env.addFilter('sort', (obj: unknown) => {
    if (Array.isArray(obj)) return [...obj].sort();
    if (obj && typeof obj === 'object') return Object.keys(obj as object).sort();
    return obj;
  });
  env.addFilter('selectattr', (arr: unknown[], attr: string, test?: string, val?: unknown) => {
    if (!Array.isArray(arr)) return [];
    if (test === 'equalto') return arr.filter((item) => (item as Record<string, unknown>)[attr] === val);
    return arr.filter((item) => !!(item as Record<string, unknown>)[attr]);
  });
  env.addFilter('repeat_str', (str: string, n: number) => new nunjucks.runtime.SafeString(str.repeat(Math.max(0, n))));
  env.addFilter('truncate_str', (str: string, n: number) => (str ? str.slice(0, n) : ''));
  env.addFilter('format', (fmt: string, ...args: unknown[]) => {
    let i = 0;
    return fmt.replace(/%\.(\d+)f|%\.(\d+)d|%s|%d/g, (match, decF, decD) => {
      const val = args[i++];
      if (match.startsWith('%.') && (decF || decD)) {
        const decimals = parseInt(decF ?? decD, 10);
        return Number(val).toFixed(decimals);
      }
      if (match === '%d') return String(Math.round(Number(val)));
      return String(val);
    });
  });

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
    console.error('No scores-*.json files found. Run `node dist/run.js` first.');
    process.exit(1);
  }

  console.log(`Loading: ${JSON.stringify(inputFiles)}`);
  const results = loadScores(inputFiles);
  const evalCount = new Set(results.map((r) => r.eval_id)).size;
  console.log(`  ${results.length} result(s) across ${evalCount} eval(s)`);

  const now = new Date();
  const generatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const html = renderHtml(results, generatedAt);
  const outputPath = join(FRAMEWORK_ROOT, opts.output as string);
  writeFileSync(outputPath, html, 'utf-8');
  console.log(`Report saved to: ${outputPath}`);
}

// Skip main() when running under Vitest (process.env.VITEST is set automatically)
if (!process.env.VITEST) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
