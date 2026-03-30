/**
 * CLI argument parsing and validation for the eval runner.
 *
 * Parses argv, validates values, and exits on error.
 */

import { Command } from 'commander';
import { EVALUATIONS } from '../config/evaluations.js';
import { ALL_MODES, DEFAULT_MODEL, KNOWN_TOOLS, KNOWN_WORKING_MODELS, parseToolsArg, type Mode } from './constants.js';

/** Validated, fully-resolved configuration derived from the CLI flags. */
export interface RunConfig {
  /** Expanded list of model identifiers to run (never empty). */
  models: string[];
  /** Execution modes to run, e.g. `["baseline"]` or `["baseline", "agent"]`. */
  modes: Mode[];
  /** Tools enabled for agent mode, e.g. `["skills"]`. Empty for baseline. */
  tools: string[];
  /** Eval IDs requested via `--eval`. Empty means run all registered evals. */
  evalIds: string[];
  /** Maximum number of concurrent jobs. */
  workers: number;
  /** Caller-supplied `--output` path, or `undefined` to use the default name. */
  outputPath: string | undefined;
  /** When `true`, agent workspaces are not deleted after the run. */
  keepWorkspace: boolean;
  /** When `true`, results are logged to a Braintrust experiment. */
  braintrust: boolean;
  /** Validated API key read from `ATKO_API_KEY`. */
  apiKey: string;
  /**
   * The raw `--mode` argument before expansion.
   *
   * Used when naming Braintrust experiments so `"all"` is preserved rather
   * than being replaced by the expanded `["baseline", "agent"]` array.
   */
  modeArg: string;
}

/**
 * Parses and validates CLI arguments, then returns a `RunConfig`.
 *
 * Calls `process.exit(1)` on any validation error so the caller never
 * has to handle invalid states.
 *
 * @param argv - Raw argument vector, typically `process.argv`.
 */
export function parseRunConfig(argv: string[]): RunConfig {
  const program = new Command();
  program
    .description('Auth0 SDK Eval Runner')
    .option('--eval <id>', 'Eval ID(s) to run (default: all)', (v, prev: string[]) => [...prev, v], [] as string[])
    .option(
      '--model <model>',
      `Model(s) to run (default: ${DEFAULT_MODEL})`,
      (v, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .option('--mode <mode>', 'Execution mode: baseline | agent | all (default: baseline)', 'baseline')
    .option(
      '--tools <tools>',
      `Tools for agent mode: ${KNOWN_TOOLS.join(', ')} (case-insensitive). Wrapping braces and comma-separation supported, e.g. {skills} or skills,mcp.`,
      '',
    )
    .option('--workers <n>', 'Parallel workers (default: 4)', '4')
    .option('--output <path>', 'JSON output path')
    .option('--keep-workspace', '(agent mode) Keep temp workspace after run', false)
    .option('--braintrust', 'Log results to Braintrust experiment', false);

  program.parse(argv);
  const opts = program.opts();

  const apiKey = process.env.ATKO_API_KEY;
  if (!apiKey) {
    console.error('Error: ATKO_API_KEY environment variable not set.');
    process.exit(1);
  }

  // Model selection
  const rawModels = opts.model as string[];
  let models: string[];
  if (rawModels.length > 0 && rawModels.includes('all')) {
    models = KNOWN_WORKING_MODELS;
    console.log(`Using all known working models: ${models.join(', ')}`);
  } else if (rawModels.length > 0) {
    models = rawModels;
  } else {
    models = [DEFAULT_MODEL];
  }

  // Mode selection
  const modeArg = opts.mode as string;
  let modes: Mode[];
  if (modeArg === 'all') {
    modes = ALL_MODES;
    console.log(`Running all modes: ${modes.join(', ')}`);
  } else {
    if (!ALL_MODES.includes(modeArg as Mode)) {
      if (modeArg === 'agent+skills') {
        console.error(`'agent+skills' mode has been replaced. Use: --mode agent --tools skills`);
      } else {
        console.error(`Invalid mode: ${modeArg}. Choose from: ${ALL_MODES.join(', ')} or 'all'`);
      }
      process.exit(1);
    }
    modes = [modeArg as Mode];
  }

  // Eval filtering
  const evalIds = opts.eval as string[];
  if (evalIds.length > 0) {
    const unknown = evalIds.filter((id) => !EVALUATIONS.some((e) => e.id === id));
    if (unknown.length > 0) {
      console.error(`Unknown eval(s): ${unknown.join(', ')}`);
      process.exit(1);
    }
  }

  // Tool validation
  const tools = parseToolsArg(opts.tools as string);
  const unknownTools = tools.filter((t) => !KNOWN_TOOLS.some((k) => k.toLowerCase() === t.toLowerCase()));
  if (unknownTools.length > 0) {
    console.error(`Unknown tool(s): ${unknownTools.join(', ')}. Known tools: ${KNOWN_TOOLS.join(', ')}`);
    process.exit(1);
  }

  // Workers validation
  const workers = parseInt(opts.workers, 10);
  if (!Number.isInteger(workers) || workers < 1) {
    console.error(`Invalid --workers value: ${JSON.stringify(opts.workers)}. Must be a positive integer.`);
    process.exit(1);
  }

  return {
    models,
    modes,
    tools,
    evalIds,
    workers,
    outputPath: opts.output as string | undefined,
    keepWorkspace: opts.keepWorkspace as boolean,
    braintrust: opts.braintrust as boolean,
    apiKey,
    modeArg,
  };
}
