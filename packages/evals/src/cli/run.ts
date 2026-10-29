#!/usr/bin/env node
/**
 * Consolidated eval runner CLI.
 *
 * Usage:
 *   a0-eval [options]
 *
 * Options:
 *   --eval        Eval ID to run (default: all). Can be repeated.
 *   --model       Model(s) to run (default: gpt-6.1-sol). Can be repeated.
 *                 Use 'all' to run all known working models.
 *   --mode        Execution mode: baseline | agent | all (default: baseline)
 *   --agent-type  Agent runner: claude-code | copilot | gemini-cli | codex
 *                 Auto-routed by model prefix when omitted (claude-* → claude-code,
 *                 gemini-* → gemini-cli, gpt-* → codex, else copilot).
 *   --tools       Tools to inject for agent mode: skills, mcp (default: none). Case-insensitive.
 *   --workers     Parallel workers (default: 4)
 *   --output      JSON output path (default: scores-<mode>.json)
 *   --keep-workspace   (agent mode) Keep temp workspace after run
 *   --braintrust       Log results to Braintrust experiment (requires BRAINTRUST_API_KEY)
 *   --phase       Run phase: all | agent | grade (default: all).
 *                 agent: run the model and write a self-contained run artefact (no grader files needed).
 *                 grade: grade stored artefacts (graders + scoring + recommendations) and emit results.
 *                 agent/grade require --artifact-dir and --dangerously-skip-sandbox.
 *   --artifact-dir     Directory run artefacts are written to (agent) or read from (grade).
 *                      Artefacts hold unredacted traces and agent-written files: treat as sensitive.
 */

import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
import { config as loadDotenv } from 'dotenv';

import {
  UnknownModeError,
  loadEval,
  loadConfig,
  discoverEvals,
  serialiseBaseline,
  serialiseAgent,
  serialiseError,
  setFrameworkConfig,
  getFrameworkConfig,
  runGraders,
  gradeText,
  BASELINE_LEVELS,
  AGENT_LEVELS,
  AGENT_MCP_LEVELS,
  isClaudeModel,
  isGeminiModel,
  isGptModel,
  registerRunner,
  getRunner,
  logger,
  writeRunArtifact,
  readRunArtifact,
  readRunArtifactManifest,
  findRunArtifacts,
  restoreArtifactWorkspace,
} from '@a0/evals-core';
import type {
  EvalConfig,
  EvalDefinition,
  JobResult,
  AgentType,
  Mode,
  RunRecord,
  CompileResult,
  ArtifactSkillFile,
  ArtifactManifest,
  RunArtifact,
} from '@a0/evals-core';

import { parseRunConfig, extractConfigPath } from './config.js';
import type { GradeFilters } from './config.js';
import { spawnEval, mergeIntoOutput } from './subprocess-runner.js';
import { DEFAULT_AGENT_TYPE } from './constants.js';
import { resolveOutputPath, mergeResults, loadResults, saveResults } from '../persistence/index.js';
import { runBaseline } from '../runners/baseline.js';
import { score } from '../scorer.js';
import { ClaudeCodeRunner } from '../runners/claude-code/runner.js';
import { CopilotCliRunner } from '../runners/copilot/runner.js';
import { GeminiCliRunner } from '../runners/gemini-cli/runner.js';
import { CodexRunner } from '../runners/codex/runner.js';
import { createBraintrustReporter } from '../reporters/braintrust.js';
import { syncDataset, toEvalSummaries } from '../reporters/braintrust-dataset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Runner registration ──────────────────────────────────────────────────────

let runnersInitialised = false;

async function initRunners(): Promise<void> {
  if (runnersInitialised) return;
  runnersInitialised = true;

  registerRunner('claude-code', new ClaudeCodeRunner());
  registerRunner('copilot', new CopilotCliRunner());
  registerRunner('gemini-cli', new GeminiCliRunner());
  registerRunner('codex', new CodexRunner());
}

// ── Per-job execution ─────────────────────────────────────────────────────────

export async function runJob(
  evalConfig: EvalConfig,
  model: string,
  mode: Mode,
  tools: string[],
  apiKey: string,
  keepWorkspace = false,
  agentType: AgentType = DEFAULT_AGENT_TYPE,
  frameworkRoot: string = process.cwd(),
  sandbox = true,
): Promise<JobResult> {
  const evalDef = await loadEval(evalConfig, frameworkRoot);
  const agentLabel = mode === 'agent' ? ` (${agentType})` : '';
  logger.info(`  [${mode}${agentLabel}] ${evalDef.id} / ${model}`);

  try {
    if (mode === 'baseline') {
      const result = await runBaseline(apiKey, model, evalDef);
      const graderResults = await gradeText(evalDef, result.responseText, apiKey, BASELINE_LEVELS);
      return serialiseBaseline(evalDef, result, graderResults, result.responseText);
    } else if (mode === 'agent') {
      return await runAgentJob(evalDef, model, mode, tools, apiKey, keepWorkspace, agentType, sandbox);
    } else {
      throw new UnknownModeError(mode);
    }
  } catch (e) {
    const errorMsg = String(e);
    logger.error(`  ✗ [${evalDef.id}] ${model} - ERROR: ${errorMsg.slice(0, 100)}`);
    return {
      ...serialiseError(evalDef.id, evalDef.category, model, mode, tools, errorMsg),
      ...(mode === 'agent' ? { agent_type: agentType } : {}),
    };
  }
}

/** Output of the agent half of a run: everything grading needs besides the workspace. */
interface AgentRunOutput {
  record: RunRecord;
  resolvedModel: string;
  compileResult: CompileResult | undefined;
}

/**
 * Creates the workspace and injects agent guidance. Must run before both the docker and
 * local execution paths so every runner picks it up.
 */
async function prepareAgentWorkspace(evalDef: EvalDefinition, agentType: AgentType): Promise<string> {
  const { setupWorkspace, writeAgentGuidance } = await import('@a0/evals-core');
  const workspace = setupWorkspace(evalDef.scaffold);
  // Inject "no docs files" guidance into the context file this runner reads
  // (CLAUDE.md / GEMINI.md / AGENTS.md). When the eval declares a
  // `provision` kind, also inject the app-configured platform context for it —
  // the `## System` section only feeds baseline mode, so this is how that
  // guidance reaches the agent.
  const cliContext = evalDef.provision ? getFrameworkConfig().cliContext?.[evalDef.provision] : undefined;
  writeAgentGuidance(workspace, agentType, {
    compileCommand: evalDef.compileCommand,
    cliContext,
  });
  return workspace;
}

/** Agent half (local execution): prepare skills, run the agent, then run the compile command. */
async function executeAgentRun(
  evalDef: EvalDefinition,
  workspace: string,
  model: string,
  tools: string[],
  apiKey: string,
  agentType: AgentType,
): Promise<AgentRunOutput> {
  const { runCompileCommand } = await import('@a0/evals-core');
  const runner = getRunner(agentType);
  const preparedEval = tools.includes('skills') ? await runner.prepareSkills(evalDef, workspace) : evalDef;
  const { record, resolvedModel } = await runner.run({ evalDef: preparedEval, workspace, model, tools, apiKey });

  const compileResult =
    evalDef.compileCommand !== undefined
      ? runCompileCommand(workspace, evalDef.compileCommand, { setupCommand: evalDef.setupCommand })
      : undefined;

  return { record, resolvedModel, compileResult };
}

/**
 * Grade half: graders, scoring, recommendations, serialisation. Reads the workspace only
 * through the file walkers, so it works on a restored artefact workspace as well. Must run
 * before the workspace is cleaned up.
 *
 * `skillFiles` (grade phase) overrides skill resolution in the recommendations step.
 */
async function gradeAgentRun(
  evalDef: EvalDefinition,
  workspace: string,
  run: AgentRunOutput,
  tools: string[],
  apiKey: string,
  agentType: AgentType,
  skillFiles?: ArtifactSkillFile[],
): Promise<JobResult> {
  const { generateRunRecommendations } = await import('../recommendations/index.js');
  const { record, resolvedModel, compileResult } = run;

  let graderResults: Awaited<ReturnType<typeof runGraders>> = [];
  if (evalDef.graders.length > 0) {
    const agentLevels = tools.includes('mcp') ? AGENT_MCP_LEVELS : AGENT_LEVELS;
    graderResults = await runGraders(
      evalDef.graders,
      workspace,
      apiKey,
      undefined,
      agentLevels,
      true,
      record.toolCalls,
      compileResult,
      record.finalSummary,
    );
  }

  const scored = score(record, graderResults, getFrameworkConfig().scoring);

  // Generate recommendations for every agent job — including the no-tools control
  // run, whose clean-room result is the best evidence for a grader defect. Must
  // happen before workspace cleanup.
  const recommendations = await generateRunRecommendations(
    evalDef,
    resolvedModel,
    tools,
    workspace,
    scored,
    record,
    apiKey,
    skillFiles,
  );

  return {
    ...serialiseAgent(evalDef, record, scored, graderResults, resolvedModel, 'agent', tools, recommendations),
    agent_type: agentType,
  };
}

async function runAgentJob(
  evalDef: EvalDefinition,
  model: string,
  mode: 'agent',
  tools: string[],
  apiKey: string,
  keepWorkspace: boolean,
  agentType: AgentType,
  sandbox: boolean,
): Promise<JobResult> {
  const { runSetupCommand, cleanupWorkspace } = await import('@a0/evals-core');
  await initRunners();

  const workspace = await prepareAgentWorkspace(evalDef, agentType);
  try {
    if (!sandbox && evalDef.setupCommand) {
      runSetupCommand(workspace, evalDef.setupCommand);
    }

    if (sandbox) {
      // Docker-sandboxed execution: run the entire agent job inside a container.
      // The container handles scoring and recommendations generation internally.
      const { runJobInDocker } = await import('../sandbox/docker.js');
      return await runJobInDocker({
        workspace,
        evalId: evalDef.id,
        model,
        mode,
        tools,
        agentType,
        apiKey,
        ghToken: process.env.GH_TOKEN,
        passthroughEnv: getFrameworkConfig().sandbox.passthroughEnv,
      });
    }

    // Local execution (--dangerously-skip-sandbox or baseline)
    const run = await executeAgentRun(evalDef, workspace, model, tools, apiKey, agentType);
    return await gradeAgentRun(evalDef, workspace, run, tools, apiKey, agentType);
  } finally {
    if (!keepWorkspace) {
      cleanupWorkspace(workspace);
    }
  }
}

// ── Agent phase (--phase agent) ───────────────────────────────────────────────

/** `<evalId>-<safeModel>-<mode>[-<tools>]` — the stem shared by temp score files and artefact dirs. */
function jobStem(evalId: string, model: string, mode: Mode, tools: string[]): string {
  const toolsSuffix = tools.length > 0 ? `-${tools.join('+')}` : '';
  const safeModel = model.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${evalId}-${safeModel}-${mode}${toolsSuffix}`;
}

/**
 * Runs one job's agent phase: executes the model and writes a run artefact to
 * `<artifactDir>/<slug>/`. No grader runs and no grader file is read. Any failure is
 * recorded as an `error` artefact so the grade phase emits the same error result as
 * today. Returns `false` when the job errored.
 */
export async function runAgentPhaseJob(
  evalConfig: EvalConfig,
  model: string,
  mode: Mode,
  tools: string[],
  apiKey: string,
  keepWorkspace: boolean,
  agentType: AgentType,
  frameworkRoot: string,
  artifactDir: string,
): Promise<boolean> {
  const artifactPath = join(
    artifactDir,
    `${jobStem(evalConfig.id, model, mode, tools)}-${randomBytes(3).toString('hex')}`,
  );
  const agentLabel = mode === 'agent' ? ` (${agentType})` : '';
  logger.info(`  [${mode}${agentLabel}] ${evalConfig.id} / ${model}  (agent phase)`);
  const common = {
    evalId: evalConfig.id,
    category: evalConfig.category,
    model,
    tools,
    ...(mode === 'agent' ? { agentType } : {}),
  };

  let workspace: string | undefined;
  try {
    const evalDef = await loadEval(evalConfig, frameworkRoot, { skipGraders: true });
    if (mode === 'baseline') {
      const result = await runBaseline(apiKey, model, evalDef);
      writeRunArtifact(artifactPath, {
        ...common,
        kind: 'baseline',
        mode: 'baseline',
        result,
        responseText: result.responseText,
      });
    } else if (mode === 'agent') {
      const { runSetupCommand } = await import('@a0/evals-core');
      const { resolveSkillFiles } = await import('../recommendations/index.js');
      await initRunners();
      workspace = await prepareAgentWorkspace(evalDef, agentType);
      if (evalDef.setupCommand) {
        runSetupCommand(workspace, evalDef.setupCommand);
      }
      const run = await executeAgentRun(evalDef, workspace, model, tools, apiKey, agentType);
      writeRunArtifact(artifactPath, {
        ...common,
        kind: 'agent',
        mode: 'agent',
        workspace,
        record: run.record,
        resolvedModel: run.resolvedModel,
        compileResult: run.compileResult,
        skillFiles: resolveSkillFiles(evalDef, tools),
      });
    } else {
      throw new UnknownModeError(mode);
    }
    logger.info(`  ✓ [${evalConfig.id}] ${model} - artefact: ${artifactPath}`);
    return true;
  } catch (e) {
    const errorMsg = String(e);
    logger.error(`  ✗ [${evalConfig.id}] ${model} - ERROR: ${errorMsg.slice(0, 100)}`);
    try {
      writeRunArtifact(artifactPath, { ...common, kind: 'error', mode, error: errorMsg });
    } catch (writeErr) {
      logger.error(`  [${evalConfig.id}] Failed to write error artefact: ${writeErr}`);
    }
    return false;
  } finally {
    if (workspace !== undefined && !keepWorkspace) {
      const { cleanupWorkspace } = await import('@a0/evals-core');
      cleanupWorkspace(workspace);
    }
  }
}

// ── Grade phase (--phase grade) ───────────────────────────────────────────────

/**
 * Grades one stored artefact into a JobResult, mirroring `runJob`'s result shapes
 * (including its catch-all `serialiseError`). The artefact is only read, except that
 * `restoreArtifactWorkspace` recreates an empty `workspace/` dropped in transit.
 */
export async function gradeArtifact(
  artifact: RunArtifact,
  evalsById: Map<string, EvalConfig>,
  apiKey: string,
  frameworkRoot: string,
): Promise<JobResult> {
  const { evalId, category, model, mode, tools } = artifact.manifest;
  const agentType = artifact.manifest.agentType ?? DEFAULT_AGENT_TYPE;
  const errorResult = (errorMsg: string, evalCategory: string): JobResult => ({
    ...serialiseError(evalId, evalCategory, model, mode, tools, errorMsg),
    ...(mode === 'agent' ? { agent_type: agentType } : {}),
  });

  if (artifact.kind === 'error') {
    logger.error(`  ✗ [${evalId}] ${model} - ERROR: ${artifact.run.error.slice(0, 100)}`);
    return errorResult(artifact.run.error, category);
  }

  const evalConfig = evalsById.get(evalId);
  try {
    if (!evalConfig) {
      throw new Error(`eval '${evalId}' (from artefact ${artifact.dir}) not found in evalsDir`);
    }
    const evalDef = await loadEval(evalConfig, frameworkRoot);
    const agentLabel = mode === 'agent' ? ` (${agentType})` : '';
    logger.info(`  [${mode}${agentLabel}] ${evalDef.id} / ${model}  (grade phase)`);

    if (artifact.kind === 'baseline') {
      const { result, responseText } = artifact.run;
      const graderResults = await gradeText(evalDef, responseText, apiKey, BASELINE_LEVELS);
      return serialiseBaseline(evalDef, result, graderResults, responseText);
    }
    const workspace = restoreArtifactWorkspace(artifact);
    const { record, resolvedModel, compileResult, skillFiles } = artifact.run;
    return await gradeAgentRun(
      evalDef,
      workspace,
      { record, resolvedModel, compileResult },
      tools,
      apiKey,
      agentType,
      skillFiles,
    );
  } catch (e) {
    const errorMsg = String(e);
    logger.error(`  ✗ [${evalId}] ${model} - ERROR: ${errorMsg.slice(0, 100)}`);
    return errorResult(errorMsg, evalConfig?.category ?? category);
  }
}

// ── CLI output ────────────────────────────────────────────────────────────────

function printResult(r: JobResult): void {
  if (r.status === 'error') return;
  if (r.mode === 'agent') {
    const agentTag = r.agent_type ? ` [${r.agent_type}]` : '';
    logger.info(
      `  ✓ [${r.eval_id}]${agentTag} ${r.model}  grade=${r.overall_grade} (${r.overall_score.toFixed(0)})  ` +
        `graders=${(r.grader_pass_rate * 100).toFixed(0)}%  $${r.cost_usd.toFixed(4)}`,
    );
  } else {
    logger.info(
      `  ✓ [${r.eval_id}] ${r.model}  graders=${r.graders_passed}/${r.graders_total} ` +
        `(${(r.grader_pass_rate * 100).toFixed(0)}%)  $${r.cost_usd.toFixed(4)}`,
    );
  }
}

function printSummary(results: JobResult[], elapsed: number): void {
  logger.info('\n' + '='.repeat(60));
  logger.info(`  Summary — ${results.length} run(s)  (${elapsed.toFixed(1)}s total)`);
  logger.info('='.repeat(60));
  const succeeded = results.filter((r) => r.status !== 'error' && r.status !== 'failure');
  const failed = results.filter((r) => r.status === 'error' || r.status === 'failure');
  logger.info(`  Passed : ${succeeded.length}`);
  logger.info(`  Failed : ${failed.length}`);
  const totalCost = results.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  logger.info(`  Cost   : $${totalCost.toFixed(4)}`);
  if (failed.length > 0) {
    logger.info('\n  Failures:');
    for (const r of failed) {
      const error = 'error' in r && typeof r.error === 'string' ? r.error : '';
      logger.info(`    ${r.eval_id}/${r.model}: ${error}`);
    }
  }
  logger.info('='.repeat(60));
}

// ── Subprocess arg stripping ──────────────────────────────────────────────────

/**
 * Returns process.argv (after the node/script pair) with all per-job flags
 * stripped out. Subprocesses receive these flags explicitly so each runs
 * exactly one (eval × model × mode × tools) job without re-expanding them.
 */
export function buildSubprocessArgs(argv: string[] = process.argv.slice(2)): string[] {
  const VALUE_FLAGS = new Set(['--eval', '--output', '--model', '--mode', '--tools', '--agent-type']);
  const stripped: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg !== undefined) {
      if (VALUE_FLAGS.has(arg)) {
        i++; // skip the paired value
        continue;
      }
      // Commander also accepts `--flag=value`; strip that form too, or the child would get
      // the parent's values on top of its own and fan out into further subprocesses.
      const eq = arg.indexOf('=');
      if (eq > 0 && VALUE_FLAGS.has(arg.slice(0, eq))) continue;
      stripped.push(arg);
    }
  }
  return stripped;
}

// ── Job routing ───────────────────────────────────────────────────────────────

/**
 * The agent runner for an agent job: `--agent-type` when given, otherwise routed by model
 * prefix (claude-* → claude-code, gemini-* → gemini-cli, gpt-* → codex, else
 * DEFAULT_AGENT_TYPE).
 */
export function resolveAgentType(model: string, agentType: AgentType | undefined): AgentType {
  if (agentType) return agentType;
  if (isClaudeModel(model)) return 'claude-code';
  if (isGeminiModel(model)) return 'gemini-cli';
  if (isGptModel(model)) return 'codex';
  return DEFAULT_AGENT_TYPE;
}

/**
 * The model recorded for a job whose runner only drives its own model family: the
 * claude-code and codex runners record a model from another family as their sentinel
 * (`'claude-code'` / `'codex'`). `undefined` when the model is recorded as given.
 */
function sentinelModelFor(agentType: AgentType, model: string): string | undefined {
  if (agentType === 'claude-code' && !isClaudeModel(model)) return 'claude-code';
  if (agentType === 'codex' && !isGptModel(model)) return 'codex';
  return undefined;
}

/**
 * Builds the flat list of (evalCfg, model, mode, tools, agentType) tuples to run.
 *
 * Auto-routing rules for agent mode:
 *   - Claude models (prefix `claude-`) with no explicit --agent-type → `claude-code`
 *   - Gemini models (prefix `gemini-`) with no explicit --agent-type → `gemini-cli`
 *   - GPT models (prefix `gpt-`) with no explicit --agent-type → `codex`
 *   - Explicit `--agent-type claude-code` with a non-Claude model → deduplicated sentinel job
 *   - Everything else → DEFAULT_AGENT_TYPE (or the explicitly requested type)
 */
export function buildJobList(
  registry: EvalConfig[],
  models: string[],
  modes: Mode[],
  tools: string[],
  agentType: AgentType | undefined,
): Array<[EvalConfig, string, Mode, string[], AgentType]> {
  const jobs: Array<[EvalConfig, string, Mode, string[], AgentType]> = [];
  const claudeCodeEvalsSeen = new Set<string>();
  const codexEvalsSeen = new Set<string>();
  const agentToolSets = [tools];
  for (const evalCfg of registry) {
    for (const model of models) {
      for (const mode of modes) {
        if (mode !== 'agent') {
          jobs.push([evalCfg, model, mode, [], agentType ?? DEFAULT_AGENT_TYPE]);
          continue;
        }
        const effectiveAgentType = resolveAgentType(model, agentType);
        for (const jobTools of agentToolSets) {
          const sentinel = sentinelModelFor(effectiveAgentType, model);
          if (sentinel === undefined) {
            jobs.push([evalCfg, model, mode, jobTools, effectiveAgentType]);
            continue;
          }
          // One sentinel job per eval and tool set, however many other-family models were requested.
          const seen = effectiveAgentType === 'claude-code' ? claudeCodeEvalsSeen : codexEvalsSeen;
          const seenKey = `${evalCfg.id}|${jobTools.join(',')}`;
          if (seen.has(seenKey)) continue;
          seen.add(seenKey);
          jobs.push([evalCfg, sentinel, mode, jobTools, effectiveAgentType]);
        }
      }
    }
  }
  return jobs;
}

// ── Main CLI entry point ──────────────────────────────────────────────────────

export async function runCli(): Promise<void> {
  // Load .env from the cwd
  loadDotenv();

  // Load the framework configuration (eval.config.js) *before* parsing CLI args
  // so `--model all` can expand to the app's `models.known`. The config path is
  // extracted from argv directly since the full parse depends on the loaded config.
  const configPath = extractConfigPath(process.argv);
  const frameworkConfig = await loadConfig({ configPath });
  setFrameworkConfig(frameworkConfig);

  const config = parseRunConfig(process.argv, {
    knownModels: frameworkConfig.models.known,
    defaultModel: frameworkConfig.models.default,
  });
  const {
    models,
    modes,
    tools,
    evalIds,
    workers,
    outputPath: outputOverride,
    keepWorkspace,
    braintrust,
    apiKey,
    agentType,
    sandbox,
    phase,
    artifactDir,
    gradeFilters,
  } = config;

  // Validate required runtime fields
  const missing: string[] = [];
  if (!frameworkConfig.proxy.baseUrl) missing.push('proxy.baseUrl');
  if (!frameworkConfig.judge.model) missing.push('judge.model');
  if (!frameworkConfig.models.default) missing.push('models.default');
  if (missing.length > 0) {
    logger.error(
      `[Config] Missing required config: ${missing.join(', ')}. ` +
        `Check your eval.config.js or pass --config <path>.`,
    );
    process.exit(1);
  }

  const frameworkRoot = process.cwd();
  // The agent phase must not need grader files on disk, so it discovers evals by PROMPT.md alone.
  const evaluations = discoverEvals(frameworkConfig.evalsDir, frameworkRoot, {
    requireGraders: phase !== 'agent',
  });
  if (evaluations.length === 0) {
    logger.error(
      `[Config] No evaluations found in evalsDir '${frameworkConfig.evalsDir}'. ` +
        `Ensure each eval directory contains PROMPT.md (with 'id' in frontmatter) and graders.ts.`,
    );
    process.exit(1);
  }

  // Validate eval IDs against loaded evaluations
  if (evalIds.length > 0) {
    const knownIds = evaluations.map((e) => e.id);
    const unknown = evalIds.filter((id) => !knownIds.includes(id));
    if (unknown.length > 0) {
      logger.error(`Unknown eval(s): ${unknown.join(', ')}`);
      process.exit(1);
    }
  }

  logger.info(`[Config] evalsDir=${frameworkConfig.evalsDir}`);

  const registry = evalIds.length > 0 ? evaluations.filter((e) => evalIds.includes(e.id)) : evaluations;

  if (registry.length === 0) {
    logger.error('No evals to run. Check your --eval flag.');
    process.exit(1);
  }

  if (phase === 'grade') {
    const outcome = await runGradePhase({
      registry,
      artifactDir: artifactDir!,
      evalIds,
      filters: gradeFilters,
      workers,
      apiKey,
      frameworkRoot,
      outputOverride,
      braintrust,
    });
    if (outcome.failed) process.exit(1);
    return;
  }

  const jobs = buildJobList(registry, models, modes, tools, agentType);

  if (phase === 'agent' && braintrust) {
    logger.warn('[Braintrust] --braintrust is ignored in the agent phase (no results yet); pass it to --phase grade.');
  }

  // Ensure Docker image exists before dispatching subprocesses — avoids N parallel builds.
  if (sandbox && modes.includes('agent')) {
    const { ensureDockerImage } = await import('../sandbox/docker.js');
    await ensureDockerImage();
  }

  // ── Subprocess-per-job parallelism ──────────────────────────────────────────
  if (jobs.length > 1) {
    const selfPath = join(__dirname, 'bin.js');
    const outputPath = resolveOutputPath(frameworkRoot, modes, outputOverride);

    const baseArgs = buildSubprocessArgs();

    const tempFiles: string[] = [];
    const subLimit = pLimit(workers);
    const settled = await Promise.allSettled(
      jobs.map(([evalCfg, model, mode, jobTools, jobAgentType]) =>
        subLimit(async () => {
          const jobArgs = [
            ...baseArgs,
            '--model',
            model,
            '--mode',
            mode,
            '--agent-type',
            jobAgentType,
            ...(jobTools.length > 0 ? ['--tools', jobTools.join(',')] : []),
          ];
          // Agent-phase subprocesses write artefacts, never a scores file (and reject --output).
          if (phase === 'agent') {
            await spawnEval(selfPath, evalCfg.id, jobArgs);
            return;
          }
          const tempFile = join(frameworkRoot, `scores-tmp-${jobStem(evalCfg.id, model, mode, jobTools)}.json`);
          tempFiles.push(tempFile);
          await spawnEval(selfPath, evalCfg.id, [...jobArgs, '--output', tempFile]);
        }),
      ),
    );

    const failures = settled.filter((s) => s.status === 'rejected');
    for (const f of failures) {
      logger.error(`  [Subprocess] ${(f as PromiseRejectedResult).reason}`);
    }

    if (phase === 'agent') {
      // Agent-phase subprocesses write artefacts, not score files: nothing to merge.
      logger.info(`\n[Output] Run artefacts written under: ${artifactDir}`);
      if (failures.length > 0) process.exit(1);
      return;
    }

    const merged = mergeIntoOutput(tempFiles, outputPath);
    logger.info(`\n[Output] Results saved to: ${outputPath}`);

    const hasErrors = failures.length > 0 || merged.some((r) => r.status === 'error');
    if (hasErrors) {
      process.exit(1);
    }
    return;
  }

  if (phase === 'agent') {
    const agentLimit = pLimit(workers);
    const oks = await Promise.all(
      jobs.map(([evalCfg, model, mode, jobTools, jobAgentType]) =>
        agentLimit(() =>
          runAgentPhaseJob(
            evalCfg,
            model,
            mode,
            jobTools,
            apiKey,
            keepWorkspace,
            jobAgentType,
            frameworkRoot,
            artifactDir!,
          ),
        ),
      ),
    );
    const failed = oks.filter((ok) => !ok).length;
    logger.info(`\n[Output] Run artefacts written under: ${artifactDir}  (${oks.length - failed}/${oks.length} ok)`);
    if (failed > 0) process.exit(1);
    return;
  }

  logger.info(`\nRunning ${jobs.length} job(s)  modes=${JSON.stringify(modes)}  workers=${workers}`);
  logger.info(`Evals : ${JSON.stringify(registry.map((e) => e.id))}`);
  logger.info(`Models: ${JSON.stringify(models)}`);
  logger.info(`Modes : ${JSON.stringify(modes)}`);
  if (modes.includes('agent')) logger.info(`Agent : ${agentType}`);
  logger.info();

  // Braintrust experiment tracking (opt-in via --braintrust flag)
  let btReporter: Awaited<ReturnType<typeof createBraintrustReporter>> = null;
  if (braintrust) {
    const btProjectId = frameworkConfig.braintrust.projectId || undefined;
    const btDatasetName = frameworkConfig.braintrust.datasetName || undefined;
    const modeLabel = modes.join(',');
    btReporter = await createBraintrustReporter(modeLabel, tools, { projectId: btProjectId });

    if (btDatasetName) {
      Promise.all(registry.map((cfg) => loadEval(cfg, frameworkRoot)))
        .then((evalDefs) =>
          syncDataset(toEvalSummaries(evalDefs), { projectId: btProjectId, datasetName: btDatasetName }),
        )
        .catch((e) => logger.error(`[Braintrust] Dataset sync error: ${e}`));
    }
  }

  const results: JobResult[] = [];
  const tStart = Date.now();

  const limit = pLimit(workers);
  await Promise.all(
    jobs.map(([evalCfg, model, mode, jobTools, jobAgentType]) =>
      limit(async () => {
        try {
          const result = await runJob(
            evalCfg,
            model,
            mode,
            jobTools,
            apiKey,
            keepWorkspace,
            jobAgentType,
            frameworkRoot,
            sandbox,
          );
          results.push(result);
          printResult(result);
          btReporter?.log(result);
        } catch (exc) {
          const toolLabel = jobTools.length > 0 ? ` [tools=${jobTools.join('+')}]` : '';
          logger.error(`  [ERROR] ${evalCfg.id}/${model}/${mode}${toolLabel}: ${exc}`);
          const errResult = {
            ...serialiseError(evalCfg.id, evalCfg.category, model, mode, jobTools, String(exc)),
            ...(mode === 'agent' ? { agent_type: jobAgentType } : {}),
          };
          results.push(errResult);
          btReporter?.log(errResult);
        }
      }),
    ),
  );

  const elapsed = (Date.now() - tStart) / 1000;
  printSummary(results, elapsed);

  if (btReporter) {
    await btReporter.summarize();
  }

  const outputPath = resolveOutputPath(frameworkRoot, modes, outputOverride);
  const existing = loadResults(outputPath);
  const merged = mergeResults(existing, results);
  saveResults(outputPath, merged);
  logger.info(`\n[Output] Results saved to: ${outputPath}`);

  const errorResults = results.filter((r) => r.status === 'error');
  if (errorResults.length > 0) {
    process.exit(1);
  }
}

/** Options for {@link runGradePhase}. */
export interface GradePhaseOptions {
  /** Discovered evals (graders required); artefacts for other evals become error results. */
  registry: EvalConfig[];
  artifactDir: string;
  /** `--eval` ids; empty means every eval. */
  evalIds: string[];
  /** Explicit `--model`/`--mode`/`--tools`/`--agent-type` filters. */
  filters: GradeFilters;
  workers: number;
  apiKey: string;
  frameworkRoot: string;
  outputOverride: string | undefined;
  braintrust: boolean;
}

/** What the grade phase produced; the CLI turns `failed` into the exit code. */
export interface GradePhaseOutcome {
  results: JobResult[];
  /** Absent when nothing was graded, in which case no file is written. */
  outputPath: string | undefined;
  failed: boolean;
}

/**
 * The key two results collide on in the output file (same as `resultKey`), so artefacts
 * sharing it would overwrite each other there.
 */
function artifactResultKey(m: ArtifactManifest): string {
  return `${m.evalId}|${m.model}|${m.mode}|${[...new Set(m.tools)].sort().join(',')}`;
}

function sameToolSet(a: string[], b: string[]): boolean {
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  return sa.length === sb.length && sa.every((t, i) => t === sb[i]);
}

/**
 * The agent type and recorded model `buildJobList` gives an agent job requested with
 * `model` and `--agent-type`. Uses the same {@link resolveAgentType} and
 * {@link sentinelModelFor} as `buildJobList`.
 */
export function agentJobIdentity(
  model: string,
  agentType: AgentType | undefined,
): { agentType: AgentType; model: string } {
  const effective = resolveAgentType(model, agentType);
  return { agentType: effective, model: sentinelModelFor(effective, model) ?? model };
}

/** What artefact selection needs: the directory and its manifest. */
export interface ArtifactRef {
  dir: string;
  manifest: ArtifactManifest;
}

/**
 * Applies the CLI filters, then keeps only the newest artefact (by `createdAt`) per result
 * key. Older artefacts with the same key would otherwise be graded too (paying for judges
 * and recommendations again) and whichever finished last would win in the output file.
 *
 * Filters select the artefacts the same flags would have produced as jobs: `--model` on an
 * agent artefact is matched through {@link agentJobIdentity} (so `--agent-type claude-code
 * --model gpt-…` finds the `claude-code` run), and `--tools` / `--agent-type` apply to agent
 * artefacts only.
 */
export function selectArtifacts<T extends ArtifactRef>(
  artifacts: T[],
  evalIds: string[],
  filters: GradeFilters,
): { selected: T[]; superseded: T[] } {
  const matching = artifacts.filter(({ manifest: m }) => {
    if (evalIds.length > 0 && !evalIds.includes(m.evalId)) return false;
    if (filters.modes && !filters.modes.includes(m.mode)) return false;
    if (m.mode !== 'agent') return !filters.models || filters.models.includes(m.model);

    const agentType = m.agentType ?? DEFAULT_AGENT_TYPE;
    if (filters.tools && !sameToolSet(filters.tools, m.tools)) return false;
    if (filters.agentType && agentType !== filters.agentType) return false;
    if (filters.models) {
      const requested = filters.models.map((model) => agentJobIdentity(model, filters.agentType));
      if (!requested.some((id) => id.model === m.model && id.agentType === agentType)) return false;
    }
    return true;
  });

  const newest = new Map<string, T>();
  for (const a of matching) {
    const key = artifactResultKey(a.manifest);
    const current = newest.get(key);
    const isNewer =
      !current ||
      a.manifest.createdAt > current.manifest.createdAt ||
      (a.manifest.createdAt === current.manifest.createdAt && a.dir > current.dir);
    if (isNewer) newest.set(key, a);
  }
  const selected = [...newest.values()].sort((x, y) => x.dir.localeCompare(y.dir));
  const kept = new Set(selected);
  return { selected, superseded: matching.filter((a) => !kept.has(a)) };
}

/**
 * Grade phase: grades the selected artefacts under `artifactDir` and writes results like
 * the in-process `all` path (`mergeResults` + `saveResults`). Each artefact is read once.
 * Writes nothing when no artefact could be graded.
 */
export async function runGradePhase(options: GradePhaseOptions): Promise<GradePhaseOutcome> {
  const { registry, artifactDir, evalIds, filters, workers, apiKey, frameworkRoot, outputOverride } = options;

  // Manifests first: filtering needs only them, and run.json (the full trace) can be large.
  // An unreadable manifest cannot be matched to a filter, so it only fails the phase when
  // nothing is filtered (every artefact under the directory is in scope).
  const filtered = evalIds.length > 0 || Object.keys(filters).length > 0;
  const refs: ArtifactRef[] = [];
  let unreadable = 0;
  for (const dir of findRunArtifacts(artifactDir)) {
    try {
      refs.push({ dir, manifest: readRunArtifactManifest(dir) });
    } catch (e) {
      if (filtered) {
        logger.warn(`  [Grade] Ignoring unreadable artefact ${dir} (outside the filters' reach): ${e}`);
      } else {
        unreadable++;
        logger.error(`  [ERROR] Cannot read artefact ${dir}: ${e}`);
      }
    }
  }

  const { selected: selectedRefs, superseded } = selectArtifacts(refs, evalIds, filters);
  for (const old of superseded) {
    logger.warn(`  [Grade] Skipping ${old.dir}: a newer artefact for the same eval/model/mode/tools exists`);
  }

  // A selected artefact whose run.json is broken is in scope, so it counts as a failure.
  const selected: RunArtifact[] = [];
  for (const ref of selectedRefs) {
    try {
      selected.push(readRunArtifact(ref.dir));
    } catch (e) {
      unreadable++;
      logger.error(`  [ERROR] Cannot read artefact ${ref.dir}: ${e}`);
    }
  }
  if (selected.length === 0) {
    logger.error(`[Config] No gradable run artefacts found under '${artifactDir}'.`);
    return { results: [], outputPath: undefined, failed: true };
  }

  const modes = [...new Set(selected.map((a) => a.manifest.mode))].sort();
  // Name the output like the `all` path would for the same flags: from an explicit --mode,
  // otherwise from the modes actually graded.
  const outputModes = filters.modes ?? modes;
  const btReporter = options.braintrust
    ? await createGradeBraintrustReporter(selected, modes, filters, registry, frameworkRoot)
    : null;

  logger.info(`\nGrading ${selected.length} artefact(s) from ${artifactDir}  workers=${workers}\n`);
  const evalsById = new Map(registry.map((e) => [e.id, e]));
  const results: JobResult[] = [];
  const tStart = Date.now();
  const limit = pLimit(workers);
  await Promise.all(
    selected.map((artifact) =>
      limit(async () => {
        const result = await gradeArtifact(artifact, evalsById, apiKey, frameworkRoot);
        results.push(result);
        printResult(result);
        btReporter?.log(result);
      }),
    ),
  );

  printSummary(results, (Date.now() - tStart) / 1000);
  if (btReporter) await btReporter.summarize();

  const outputPath = resolveOutputPath(frameworkRoot, outputModes, outputOverride);
  saveResults(outputPath, mergeResults(loadResults(outputPath), results));
  logger.info(`\n[Output] Results saved to: ${outputPath}`);

  return { results, outputPath, failed: unreadable > 0 || results.some((r) => r.status === 'error') };
}

/** Braintrust reporting for the grade phase, mirroring the `all` path's setup. */
async function createGradeBraintrustReporter(
  selected: RunArtifact[],
  modes: string[],
  filters: GradeFilters,
  registry: EvalConfig[],
  frameworkRoot: string,
): Promise<Awaited<ReturnType<typeof createBraintrustReporter>>> {
  const frameworkConfig = getFrameworkConfig();
  const btProjectId = frameworkConfig.braintrust.projectId || undefined;
  const btDatasetName = frameworkConfig.braintrust.datasetName || undefined;
  const agentTools = selected.filter((a) => a.manifest.mode === 'agent').map((a) => a.manifest.tools);
  const tools =
    filters.tools ??
    (agentTools.length > 0 && agentTools.every((t) => sameToolSet(t, agentTools[0]!)) ? agentTools[0]! : []);
  const reporter = await createBraintrustReporter(modes.join(','), tools, { projectId: btProjectId });

  if (btDatasetName) {
    const gradedIds = new Set(selected.map((a) => a.manifest.evalId));
    Promise.all(registry.filter((cfg) => gradedIds.has(cfg.id)).map((cfg) => loadEval(cfg, frameworkRoot)))
      .then((evalDefs) =>
        syncDataset(toEvalSummaries(evalDefs), { projectId: btProjectId, datasetName: btDatasetName }),
      )
      .catch((e) => logger.error(`[Braintrust] Dataset sync error: ${e}`));
  }
  return reporter;
}
