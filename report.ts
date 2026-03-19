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
// When running from dist/, go up one level to the project root.
// When running from source (Vitest), __dirname is already the project root.
const FRAMEWORK_ROOT = basename(__dirname) === 'dist' ? join(__dirname, '..') : __dirname;

const MODES = ['baseline', 'agent', 'agent+skills'];

export function loadScores(paths: string[]): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  for (const p of paths) {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>[];
    results.push(...data);
  }
  return results;
}

export function groupResults(results: Record<string, unknown>[]): Record<string, Record<string, Record<string, unknown>>> {
  const grouped: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const r of results) {
    const eid = r.eval_id as string;
    const key = `${r.model as string}|${r.mode as string}`;
    if (!grouped[eid]) grouped[eid] = {};
    grouped[eid][key] = r;
  }
  return grouped;
}

export function renderHtml(results: Record<string, unknown>[], generatedAt: string): string {
  const grouped = groupResults(results);

  const keySet = new Set<string>();
  for (const runs of Object.values(grouped)) {
    for (const key of Object.keys(runs)) {
      keySet.add(key);
    }
  }
  const allKeys = [...keySet].sort((a, b) => {
    const [aModel, aMode] = a.split('|');
    const [bModel, bMode] = b.split('|');
    const aModeIdx = MODES.indexOf(aMode) !== -1 ? MODES.indexOf(aMode) : 99;
    const bModeIdx = MODES.indexOf(bMode) !== -1 ? MODES.indexOf(bMode) : 99;
    if (aModeIdx !== bModeIdx) return aModeIdx - bModeIdx;
    return aModel.localeCompare(bModel);
  });
  const allKeyObjects = allKeys.map((k) => { const [model, mode] = k.split('|'); return { model, mode, key: k }; });

  const totalRuns = results.length;
  const totalCost = results.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  const modelsRun = [...new Set(results.map((r) => r.model as string))].sort();
  const modesRun = [...new Set(results.map((r) => r.mode as string))].sort();

  function sortResultKeys(keys: string[]): string[] {
    return [...keys].sort((a, b) => {
      const [aModel, aMode] = a.split('|');
      const [bModel, bMode] = b.split('|');
      const aModeIdx = MODES.indexOf(aMode) !== -1 ? MODES.indexOf(aMode) : 99;
      const bModeIdx = MODES.indexOf(bMode) !== -1 ? MODES.indexOf(bMode) : 99;
      if (aModeIdx !== bModeIdx) return aModeIdx - bModeIdx;
      return aModel.localeCompare(bModel);
    });
  }

  const env = nunjucks.configure(join(FRAMEWORK_ROOT, 'templates'), {
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
  env.addFilter('repeat_str', (str: string, n: number) => str.repeat(Math.max(0, n)));
  env.addFilter('truncate_str', (str: string, n: number) => str ? str.slice(0, n) : '');
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

  const groupedSortedKeys = Object.keys(grouped).sort();

  return nunjucks.render('report.html.j2', {
    grouped,
    grouped_sorted_keys: groupedSortedKeys,
    all_keys: allKeyObjects,
    total_runs: totalRuns,
    total_cost: totalCost,
    models_run: modelsRun,
    modes_run: modesRun,
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

  let inputFiles: string[] = opts.input as string[] | undefined ?? [];
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
