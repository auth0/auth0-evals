/**
 * CLI argument parsing and validation for the eval runner.
 *
 * Parses argv, validates values, and exits on error.
 */

import { Command } from 'commander';
import { EVALUATIONS } from '../config/evaluations.js';
import { logger } from '../utils/logger.js';
import {
  ALL_MODES,
  DEFAULT_MODEL,
  KNOWN_TOOLS,
  KNOWN_WORKING_MODELS,
  parseToolsArg,
  KNOWN_AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  type Mode,
  type AgentType,
} from './constants.js';

/** Valid meta-values accepted by `--mode` in addition to the concrete Mode values. */
const META_MODES = ['all'] as const;

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
   * `"auth0-ReAct-agent"` runs the custom ReAct loop via the ATKO LLM gateway.
   * `"claude-code"` spawns the Claude Code CLI and parses its JSONL stream.
   * `"copilot"` spawns GitHub Copilot CLI and parses its JSONL stream.
   */
  agentType: AgentType | undefined;
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
    .option('--braintrust', 'Log results to Braintrust experiment', false);

  program.parse(argv);
  const opts = program.opts();

  const apiKey = process.env.ATKO_API_KEY;
  if (!apiKey) {
    logger.error('Error: ATKO_API_KEY environment variable not set.');
    process.exit(1);
  }

  const matrix = opts.matrix as boolean;

  // Model selection — --matrix defaults to all models, explicit --model narrows
  const rawModels = opts.model as string[];
  let models: string[];
  if (rawModels.length > 0 && rawModels.includes('all')) {
    models = KNOWN_WORKING_MODELS;
    logger.info(`Using all known working models: ${models.join(', ')}`);
  } else if (rawModels.length > 0) {
    models = rawModels;
  } else if (matrix) {
    models = KNOWN_WORKING_MODELS;
    logger.info(`Using all known working models: ${models.join(', ')}`);
  } else {
    models = [DEFAULT_MODEL];
  }

  // Mode selection — --matrix defaults to all modes, explicit --mode narrows
  const modeArg = opts.mode as string | undefined;
  let modes: Mode[];
  if (modeArg == null) {
    // No explicit --mode: use all modes in matrix, baseline otherwise
    modes = matrix ? ALL_MODES : ['baseline'];
  } else if (modeArg === 'all') {
    modes = ALL_MODES;
    logger.info(`Running all modes: ${modes.join(', ')}`);
  } else if (modeArg === 'matrix') {
    logger.error(`'--mode matrix' has been replaced. Use the standalone --matrix flag instead.`);
    process.exit(1);
  } else if (!ALL_MODES.includes(modeArg as Mode)) {
    if (modeArg === 'agent+skills') {
      logger.error(`'agent+skills' mode has been replaced. Use: --mode agent --tools skills`);
    } else {
      const validValues = [...ALL_MODES, ...META_MODES].join(', ');
      logger.error(`Invalid mode: ${modeArg}. Choose from: ${validValues}`);
    }
    process.exit(1);
  } else {
    modes = [modeArg as Mode];
  }

  if (matrix) {
    logger.info(`Running matrix: ${modes.join(', ')} × ${['none', 'skills', 'mcp+skills'].join(', ')}`);
  }

  // Eval filtering
  const evalIds = opts.eval as string[];
  if (evalIds.length > 0) {
    const unknown = evalIds.filter((id) => !EVALUATIONS.some((e) => e.id === id));
    if (unknown.length > 0) {
      logger.error(`Unknown eval(s): ${unknown.join(', ')}`);
      process.exit(1);
    }
  }

  // Tool validation
  const tools = parseToolsArg(opts.tools as string);
  const unknownTools = tools.filter((t) => !KNOWN_TOOLS.some((k) => k.toLowerCase() === t.toLowerCase()));
  if (unknownTools.length > 0) {
    logger.error(`Unknown tool(s): ${unknownTools.join(', ')}. Known tools: ${KNOWN_TOOLS.join(', ')}`);
    process.exit(1);
  }

  // Workers validation — matrix defaults to 20, otherwise 4
  const workers = parseInt((opts.workers as string | undefined) ?? (matrix ? '20' : '4'), 10);
  if (!Number.isInteger(workers) || workers < 1) {
    logger.error(`Invalid --workers value: ${JSON.stringify(opts.workers)}. Must be a positive integer.`);
    process.exit(1);
  }

  // Agent type validation
  const agentType = opts.agentType as AgentType | undefined;
  if (agentType !== undefined && !(KNOWN_AGENT_TYPES as readonly string[]).includes(agentType)) {
    logger.error(`Invalid --agent-type: ${agentType}. Choose from: ${KNOWN_AGENT_TYPES.join(', ')}`);
    process.exit(1);
  }

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
  };
}
