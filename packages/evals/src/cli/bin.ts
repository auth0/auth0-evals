#!/usr/bin/env node
import { Command } from 'commander';
import { runCli } from './run.js';
import { runReport } from './report.js';
import type { ReportOptions } from './report.js';
import { runReplay } from './replay.js';
import type { ReplayOptions } from './replay.js';
import { ensureSubCommand } from './ensure-sub-command.js';

const program = new Command();
program.name('a0-eval').description('Auth0 eval framework CLI');

program
  .command('run', { isDefault: true })
  .description('Run evaluations')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async () => {
    await runCli();
  });

program
  .command('report')
  .description('Generate HTML report from score files')
  .option('--input <files...>', 'Score JSON files (default: auto-discover scores-*.json)')
  .option('--output <path>', 'Output HTML path', 'report.html')
  .action(async (opts: ReportOptions) => {
    await runReport(opts);
  });

program
  .command('replay')
  .description('Grade scripted reference and mutant solutions against a live tenant, without an LLM')
  .requiredOption('--eval <id>', 'Eval id (must have fixture.ts and replay/reference.sh)')
  .option('--config <path>', 'Path to eval.config.js')
  .action(async (opts: ReplayOptions) => {
    await runReplay(opts);
  });

program.parseAsync(ensureSubCommand(process.argv)).catch((e) => {
  // eslint-disable-next-line no-console -- top-level CLI error handler
  console.error(e);
  process.exit(1);
});
