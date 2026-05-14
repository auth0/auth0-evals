/**
 * Report sub-command — generates an HTML report from eval score files.
 *
 * Usage (via bin):
 *   a0-eval report                          # auto-discovers scores-*.json
 *   a0-eval report --input scores-baseline.json scores-skills.json
 *   a0-eval report --output my-report.html
 */

import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderHtml, loadScores } from '@a0/eval-reporter';
import { logger } from '@a0/eval-core';

export interface ReportOptions {
  input?: string[];
  output: string;
}

export async function runReport(opts: ReportOptions): Promise<void> {
  const frameworkRoot = process.cwd();

  let inputFiles: string[] = opts.input ?? [];
  if (inputFiles.length === 0) {
    inputFiles = readdirSync(frameworkRoot)
      .filter((f) => /^scores-.*\.json$/.test(f))
      .map((f) => join(frameworkRoot, f))
      .sort();
  }

  if (inputFiles.length === 0) {
    throw new Error('No scores-*.json files found. Run `a0-eval run` first.');
  }

  logger.info(`Loading: ${JSON.stringify(inputFiles)}`);
  const results = loadScores(inputFiles);
  const evalCount = new Set(results.map((r) => r.eval_id)).size;
  logger.info(`  ${results.length} result(s) across ${evalCount} eval(s)`);

  const now = new Date();
  const generatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const html = renderHtml(results, generatedAt);
  const outputPath = join(frameworkRoot, opts.output);
  writeFileSync(outputPath, html, 'utf-8');
  logger.info(`Report saved to: ${outputPath}`);

  const consolidatedPath = join(frameworkRoot, 'scores-consolidated.json');
  writeFileSync(consolidatedPath, JSON.stringify(results, null, 2), 'utf-8');
  logger.info(`Consolidated JSON saved to: ${consolidatedPath}`);
}
