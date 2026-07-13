#!/usr/bin/env node
/**
 * Consolidated eval runner CLI.
 *
 * Usage:
 *   a0-eval [options]
 *
 * Options:
 *   --eval        Eval ID to run (default: all). Can be repeated.
 *   --model       Model(s) to run (default: gpt-5.4). Can be repeated.
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
 */

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
} from '@a0/eval-core';
import type { EvalConfig, EvalDefinition, JobResult, AgentType, Mode } from '@a0/eval-core';

import { parseRunConfig, extractConfigPath } from './config.js';
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
  const { setupWorkspace, runSetupCommand, runCompileCommand, cleanupWorkspace, writeAgentGuidance } =
    await import('@a0/eval-core');
  const { generateRunRecommendations } = await import('../recommendations/index.js');
  await initRunners();

  const workspace = setupWorkspace(evalDef.scaffold);
  // Inject "no docs files" guidance into the context file this runner reads
  // (CLAUDE.md / GEMINI.md / AGENTS.md). Must run before both the docker and
  // local execution paths so every runner picks it up.
  writeAgentGuidance(workspace, agentType, evalDef.compileCommand);
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
      });
    }

    // Local execution (--dangerously-skip-sandbox or baseline)
    const runner = getRunner(agentType);
    const preparedEval = tools.includes('skills') ? await runner.prepareSkills(evalDef, workspace) : evalDef;
    const { record, resolvedModel } = await runner.run({ evalDef: preparedEval, workspace, model, tools, apiKey });

    const compileResult =
      evalDef.compileCommand !== undefined
        ? runCompileCommand(workspace, evalDef.compileCommand, { setupCommand: evalDef.setupCommand })
        : undefined;

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
      );
    }

    const scored = score(record, graderResults, getFrameworkConfig().scoring);

    // Generate recommendations only when skills or MCP are enabled (must happen before workspace cleanup)
    const recommendations = await generateRunRecommendations(
      evalDef,
      resolvedModel,
      tools,
      workspace,
      scored,
      record,
      apiKey,
    );

    return {
      ...serialiseAgent(evalDef, record, scored, graderResults, resolvedModel, mode, tools, recommendations),
      agent_type: agentType,
    };
  } finally {
    if (!keepWorkspace) {
      cleanupWorkspace(workspace);
    }
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
      stripped.push(arg);
    }
  }
  return stripped;
}

// ── Job routing ───────────────────────────────────────────────────────────────

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
        const effectiveAgentType: AgentType =
          !agentType && isClaudeModel(model)
            ? 'claude-code'
            : !agentType && isGeminiModel(model)
              ? 'gemini-cli'
              : !agentType && isGptModel(model)
                ? 'codex'
                : (agentType ?? DEFAULT_AGENT_TYPE);
        for (const jobTools of agentToolSets) {
          if (effectiveAgentType === 'claude-code') {
            if (isClaudeModel(model)) {
              jobs.push([evalCfg, model, mode, jobTools, effectiveAgentType]);
            } else {
              const seenKey = `${evalCfg.id}|${jobTools.join(',')}`;
              if (claudeCodeEvalsSeen.has(seenKey)) continue;
              claudeCodeEvalsSeen.add(seenKey);
              jobs.push([evalCfg, 'claude-code', mode, jobTools, effectiveAgentType]);
            }
          } else if (effectiveAgentType === 'codex') {
            if (isGptModel(model)) {
              jobs.push([evalCfg, model, mode, jobTools, effectiveAgentType]);
            } else {
              const seenKey = `${evalCfg.id}|${jobTools.join(',')}`;
              if (codexEvalsSeen.has(seenKey)) continue;
              codexEvalsSeen.add(seenKey);
              jobs.push([evalCfg, 'codex', mode, jobTools, effectiveAgentType]);
            }
          } else {
            jobs.push([evalCfg, model, mode, jobTools, effectiveAgentType]);
          }
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

  const config = parseRunConfig(process.argv, { knownModels: frameworkConfig.models.known });
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
  const evaluations = discoverEvals(frameworkConfig.evalsDir, frameworkRoot);
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

  const jobs = buildJobList(registry, models, modes, tools, agentType);

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
          const toolsSuffix = jobTools.length > 0 ? `-${jobTools.join('+')}` : '';
          const safeModel = model.replace(/[^a-zA-Z0-9.-]/g, '_');
          const tempFile = join(frameworkRoot, `scores-tmp-${evalCfg.id}-${safeModel}-${mode}${toolsSuffix}.json`);
          tempFiles.push(tempFile);
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
          await spawnEval(selfPath, evalCfg.id, [...jobArgs, '--output', tempFile]);
        }),
      ),
    );

    const failures = settled.filter((s) => s.status === 'rejected');
    for (const f of failures) {
      logger.error(`  [Subprocess] ${(f as PromiseRejectedResult).reason}`);
    }

    const merged = mergeIntoOutput(tempFiles, outputPath);
    logger.info(`\n[Output] Results saved to: ${outputPath}`);

    const hasErrors = failures.length > 0 || merged.some((r) => r.status === 'error');
    if (hasErrors) {
      process.exit(1);
    }
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
