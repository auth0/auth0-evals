/**
 * CLI argument parsing for the eval runner.
 *
 * Defines the Commander program, parses argv, delegates validation to
 * `./validators.js`, and returns a fully-resolved `RunConfig`.
 */

import { Command } from 'commander';
import {
  DEFAULT_MODEL,
  KNOWN_TOOLS,
  KNOWN_AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  type Mode,
  type AgentType,
  type Phase,
} from './constants.js';
import {
  validateApiKey,
  validateModels,
  validateModes,
  validateEvalIds,
  validateTools,
  validateWorkers,
  validateAgentType,
  validatePhase,
  validatePhaseOptions,
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
  /** Validated API key read from `LLM_API_KEY`. */
  apiKey: string;
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
  /**
   * Run phase. `all` (default) runs agent + grading in one go; `agent` runs the model and
   * writes run artefacts under `artifactDir`; `grade` grades artefacts found under `artifactDir`.
   */
  phase: Phase;
  /** Directory for run artefacts (`--artifact-dir`). Required for `agent` and `grade` phases. */
  artifactDir: string | undefined;
  /**
   * Filters for `--phase grade`, set only for flags passed explicitly on the command line.
   * `--model` and `--mode` have defaults, so their resolved values above cannot tell
   * "filter to this" from "not given".
   */
  gradeFilters: GradeFilters;
}

/** Artefact filters for `--phase grade`; an absent field means "do not filter on it". */
export interface GradeFilters {
  models?: string[];
  modes?: Mode[];
  tools?: string[];
  agentType?: AgentType;
}

export interface ParseRunConfigOptions {
  /** List of known eval IDs for validation. When omitted, eval ID validation is skipped. */
  knownEvalIds?: string[];
  /**
   * Models that `--model all` expands to — typically the app's `models.known`
   * from `eval.config.js`. When omitted or empty, the framework's
   * `KNOWN_WORKING_MODELS` fallback is used instead.
   */
  knownModels?: string[];
  /**
   * Model used when `--model` is omitted entirely — typically the app's
   * `models.default` from `eval.config.js`. When omitted or empty, the
   * framework's `DEFAULT_MODEL` constant is used instead.
   */
  defaultModel?: string;
}

/**
 * Extracts the `--config <path>` value from a raw argv without a full parse.
 *
 * Needed because the framework config must be loaded *before* `parseRunConfig`
 * runs (so `--model all` can expand to the app's `models.known`), but the
 * config path itself lives in argv. Supports both `--config <path>` and
 * `--config=<path>` forms. Returns `undefined` when the flag is absent.
 */
export function extractConfigPath(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--config') {
      return argv[i + 1];
    }
    if (arg.startsWith('--config=')) {
      return arg.slice('--config='.length);
    }
  }
  return undefined;
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
      `Model(s) to run (default: ${options.defaultModel && options.defaultModel.length > 0 ? options.defaultModel : DEFAULT_MODEL})`,
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
      `Agent runner for agent mode: ${KNOWN_AGENT_TYPES.join(' | ')}. Auto-routed by model prefix when omitted (claude-* → claude-code, gemini-* → gemini-cli, gpt-* → codex, else ${DEFAULT_AGENT_TYPE}).`,
    )
    .option('--workers <n>', 'Parallel workers (default: 4)')
    .option('--output <path>', 'JSON output path')
    .option('--keep-workspace', '(agent mode) Keep temp workspace after run', false)
    .option('--braintrust', 'Log results to Braintrust experiment', false)
    .option('--config <path>', 'Path to eval.config.js (overrides auto-discovery)')
    .option(
      '--dangerously-skip-sandbox',
      'Disable Docker sandboxing — run agent jobs directly on the host (used in CI)',
      false,
    )
    .option(
      '--phase <phase>',
      'Run phase: agent (run model, write artefact) | grade (grade stored artefacts) | all (default). agent/grade require --artifact-dir and --dangerously-skip-sandbox.',
    )
    .option('--artifact-dir <dir>', 'Directory where run artefacts are written (agent phase) or read (grade phase)');

  program.parse(argv);
  const opts = program.opts();

  const apiKey = validateApiKey();
  const models = validateModels(opts.model as string[], options.knownModels, options.defaultModel);
  const modes = validateModes(opts.mode as string | undefined);

  const evalIds = options.knownEvalIds
    ? validateEvalIds(opts.eval as string[], options.knownEvalIds)
    : (opts.eval as string[]);
  const tools = validateTools(opts.tools as string);
  const workers = validateWorkers(opts.workers as string | undefined);
  const agentType = validateAgentType(opts.agentType as string | undefined);
  const phase = validatePhase(opts.phase as string | undefined);
  const artifactDir = opts.artifactDir as string | undefined;
  const sandbox = !(opts.dangerouslySkipSandbox as boolean);
  validatePhaseOptions(phase, artifactDir, sandbox, opts.output as string | undefined);
  const fromCli = (key: string): boolean => program.getOptionValueSource(key) === 'cli';
  const gradeFilters: GradeFilters = {
    ...(fromCli('model') ? { models } : {}),
    ...(fromCli('mode') ? { modes } : {}),
    ...(fromCli('tools') ? { tools } : {}),
    ...(fromCli('agentType') && agentType !== undefined ? { agentType } : {}),
  };

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
    agentType,
    configPath: opts.config as string | undefined,
    sandbox,
    phase,
    artifactDir,
    gradeFilters,
  };
}
