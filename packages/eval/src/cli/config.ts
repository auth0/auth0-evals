/**
 * CLI argument parsing for the eval runner.
 *
 * Defines the Commander program, parses argv, delegates validation to
 * `./validators.js`, and returns a fully-resolved `RunConfig`.
 */

import { Command } from 'commander';
import { logger } from '@a0/eval-core';
import {
  DEFAULT_MODEL,
  KNOWN_TOOLS,
  KNOWN_AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  type Mode,
  type AgentType,
} from './constants.js';
import {
  validateApiKey,
  validateModels,
  validateModes,
  validateEvalIds,
  validateTools,
  validateWorkers,
  validateAgentType,
} from './validators.js';

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
   * When `true`, `--matrix` was passed. Shorthand for running all evals × all
   * models × all modes × all tool-set combinations. Explicit `--eval`, `--model`,
   * or `--mode` flags narrow the matrix. `buildJobList` uses this to expand
   * agent mode across all tool-set combinations.
   */
  matrix: boolean;
  /**
   * The agent runner to use for agent-mode jobs.
   * `undefined` when --agent-type was not passed; claude-* models are then auto-routed to claude-code.
   */
  agentType: AgentType | undefined;
  /** Explicit path to an `eval.config.js` file. Overrides auto-discovery when set. */
  configPath: string | undefined;
  /**
   * When `true`, agent-mode jobs run inside a Docker container for isolation.
   * Defaults to `true` — pass `--dangerously-skip-sandbox` to disable.
   */
  sandbox: boolean;
}

export interface ParseRunConfigOptions {
  /** List of known eval IDs for validation. When omitted, eval ID validation is skipped. */
  knownEvalIds?: string[];
}

/**
 * Parses and validates CLI arguments, then returns a `RunConfig`.
 *
 * Calls `process.exit(1)` on any validation error so the caller never
 * has to handle invalid states.
 *
 * @param argv - Raw argument vector, typically `process.argv`.
 * @param options - Additional context (known eval IDs) for validation.
 */
export function parseRunConfig(argv: string[], options: ParseRunConfigOptions = {}): RunConfig {
  const program = new Command();
  program
    .description('Eval Runner')
    .option('--eval <id>', 'Eval ID(s) to run (default: all)', (v, prev: string[]) => [...prev, v], [] as string[])
    .option(
      '--model <model>',
      `Model(s) to run (default: ${DEFAULT_MODEL})`,
      (v, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .option('--mode <mode>', 'Execution mode: baseline | agent | all (default: baseline)')
    .option(
      '--tools <tools>',
      `Tools for agent mode: ${KNOWN_TOOLS.join(', ')} (case-insensitive). Wrapping braces and comma-separation supported, e.g. {skills} or skills,mcp.`,
      '',
    )
    .option(
      '--agent-type <type>',
      `Agent runner for agent mode: ${KNOWN_AGENT_TYPES.join(' | ')} (default: ${DEFAULT_AGENT_TYPE})`,
    )
    .option(
      '--matrix',
      'Run the full eval matrix: all evals × all models × all modes × all tool-set combinations',
      false,
    )
    .option('--workers <n>', 'Parallel workers (default: 4; default in matrix mode: 20)')
    .option('--output <path>', 'JSON output path')
    .option('--keep-workspace', '(agent mode) Keep temp workspace after run', false)
    .option('--braintrust', 'Log results to Braintrust experiment', false)
    .option('--config <path>', 'Path to eval.config.js (overrides auto-discovery)')
    .option(
      '--dangerously-skip-sandbox',
      'Disable Docker sandboxing — run agent jobs directly on the host (used in CI)',
      false,
    );

  program.parse(argv);
  const opts = program.opts();

  const apiKey = validateApiKey();
  const matrix = opts.matrix as boolean;
  const models = validateModels(opts.model as string[], matrix);
  const modes = validateModes(opts.mode as string | undefined, matrix);

  if (matrix) {
    logger.info(`Running matrix: ${modes.join(', ')} × ${['none', 'skills', 'mcp+skills'].join(', ')}`);
  }

  const evalIds = options.knownEvalIds
    ? validateEvalIds(opts.eval as string[], options.knownEvalIds)
    : (opts.eval as string[]);
  const tools = validateTools(opts.tools as string);
  const workers = validateWorkers(opts.workers as string | undefined, matrix);
  const agentType = validateAgentType(opts.agentType as string | undefined);

  return {
    models,
    modes,
    matrix,
    tools,
    evalIds,
    workers,
    outputPath: opts.output as string | undefined,
    keepWorkspace: opts.keepWorkspace as boolean,
    braintrust: opts.braintrust as boolean,
    apiKey,
    agentType,
    configPath: opts.config as string | undefined,
    sandbox: !(opts.dangerouslySkipSandbox as boolean),
  };
}
