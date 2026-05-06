#!/usr/bin/env node
/**
 * Report CLI — thin wrapper around @a0/eval-reporter.
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
import { renderHtml, loadScores } from '@a0/eval-reporter';
import { logger } from '@a0/eval';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRAMEWORK_ROOT = ['dist', 'src'].includes(basename(__dirname)) ? join(__dirname, '..') : __dirname;

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
