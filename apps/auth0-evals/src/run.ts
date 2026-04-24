#!/usr/bin/env node
/**
 * Consolidated eval runner.
 *
 * Usage:
 *   node dist/run.js [options]
 *
 *   API key is loaded from .env automatically. Copy .env.example to .env
 *   and fill in your ATKO_API_KEY.
 *
 * Options:
 *   --eval        Eval ID to run (default: all). Can be repeated.
 *   --model       Model(s) to run (default: gpt-5.2). Can be repeated.
 *                 Use 'all' to run all known working models.
 *   --mode        Execution mode: baseline | agent | all (default: baseline)
 *   --matrix      Run all evals × all models × all modes × all tool-set combinations
 *   --agent-type  Agent runner for agent mode: auth0-ReAct-agent | claude-code | copilot (default: auth0-ReAct-agent)
 *   --tools       Tools to inject for agent mode: skills, mcp (default: none). Case-insensitive.
 *   --workers     Parallel workers (default: 4)
 *   --output      JSON output path (default: scores-<mode>.json)
 *   --keep-workspace   (agent mode) Keep temp workspace after run
 *   --braintrust       Log results to Braintrust experiment (requires BRAINTRUST_API_KEY)
 */

import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
import { config as loadDotenv } from 'dotenv';
import { EVALUATIONS, type EvalConfig } from './config/evaluations.js';
import { UnknownModeError } from './errors.js';
import { loadEval, type EvalDefinition } from './runners/loader.js';
import { runGraders } from './agent_eval/graders.js';
import { serialiseBaseline, serialiseAgent, serialiseError } from './runners/serializers.js';
import { mergeResults, loadResults, saveResults, resolveOutputPath } from './persistence/results.js';
import { parseRunConfig } from './cli/config.js';
import { logger } from './utils/logger.js';
import type { JobResult } from './types/results.js';
import { gradeText } from './agent_eval/grade-text.js';
import { BASELINE_LEVELS, AGENT_LEVELS, AGENT_MCP_LEVELS } from './agent_eval/grading-levels.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRAMEWORK_ROOT = ['dist', 'src'].includes(basename(__dirname)) ? join(__dirname, '..') : __dirname;

// Load .env
loadDotenv({ path: join(FRAMEWORK_ROOT, '.env') });

export {
  ALL_MODES,
  DEFAULT_MODEL,
  KNOWN_TOOLS,
  KNOWN_WORKING_MODELS,
  KNOWN_AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  MATRIX_TOOL_SETS,
  parseToolsArg,
  type Mode,
  type AgentType,
} from './cli/constants.js';
import type { Mode, AgentType } from './cli/constants.js';
import { DEFAULT_AGENT_TYPE, MATRIX_TOOL_SETS } from './cli/constants.js';

// ── Per-job execution ─────────────────────────────────────────────────────────

export async function runJob(
  evalConfig: EvalConfig,
  model: string,
  mode: Mode,
  tools: string[],
  apiKey: string,
  keepWorkspace = false,
  agentType: AgentType = DEFAULT_AGENT_TYPE,
): Promise<JobResult> {
  const evalDef = await loadEval(evalConfig, FRAMEWORK_ROOT);
  const agentLabel = mode === 'agent' ? ` (${agentType})` : '';
  logger.info(`  [${mode}${agentLabel}] ${evalDef.id} / ${model}`);

  try {
    if (mode === 'baseline') {
      const { runBaseline } = await import('./runners/baseline.js');
      const result = await runBaseline(apiKey, model, evalDef);
      const graderResults = await gradeText(evalDef, result.responseText, apiKey, BASELINE_LEVELS);
      return serialiseBaseline(evalDef, result, graderResults, result.responseText);
    } else if (mode === 'agent') {
      return await runAgentJob(evalDef, model, mode, tools, apiKey, keepWorkspace, agentType);
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
): Promise<JobResult> {
  const { setupWorkspace, cleanupWorkspace } = await import('./agent_eval/workspace.js');
  const { score } = await import('./agent_eval/scorer.js');
  const { initAgentRegistry, getRunner } = await import('./agent_eval/agent-registry.js');
  initAgentRegistry();

  const workspace = setupWorkspace(evalDef.scaffold);
  try {
    const runner = getRunner(agentType);
    const preparedEval = tools.includes('skills') ? await runner.prepareSkills(evalDef, workspace) : evalDef;
    const { record, resolvedModel } = await runner.run({ evalDef: preparedEval, workspace, model, tools, apiKey });

    let graderResults: Awaited<ReturnType<typeof runGraders>> = [];
    if (evalDef.graders.length > 0) {
      // L5 (version_correctness) only runs when MCP is enabled — the model has docs
      // access, so using deprecated APIs is a real failure. Without MCP, the model
      // works from training data and shouldn't be penalized for version drift.
      const agentLevels = tools.includes('mcp') ? AGENT_MCP_LEVELS : AGENT_LEVELS;
      graderResults = await runGraders(evalDef.graders, workspace, apiKey, undefined, agentLevels);
    }

    const scored = score(record, graderResults);
    return {
      ...serialiseAgent(evalDef, record, scored, graderResults, resolvedModel, mode, tools),
      agent_type: agentType,
    };
  } finally {
    if (!keepWorkspace) {
      cleanupWorkspace(workspace);
    }
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function printResult(r: JobResult): void {
  if (r.status === 'error') return; // already reported in runJob's catch block
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

/**
 * Returns process.argv (after the node/script pair) with all per-job flags
 * stripped out. Subprocesses receive these flags explicitly so each runs
 * exactly one (eval × model × mode × tools) job without re-expanding them.
 *
 * Flags with paired values that are stripped: --eval, --output, --model,
 * --mode, --tools, --agent-type.
 * Boolean flags stripped: --matrix (already expanded into individual jobs).
 */
export function buildSubprocessArgs(argv: string[] = process.argv.slice(2)): string[] {
  const VALUE_FLAGS = new Set(['--eval', '--output', '--model', '--mode', '--tools', '--agent-type']);
  const BOOL_FLAGS = new Set(['--matrix']);
  const stripped: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg !== undefined) {
      if (VALUE_FLAGS.has(arg)) {
        i++; // skip the paired value
        continue;
      }
      if (BOOL_FLAGS.has(arg)) {
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
 *   - GPT models (prefix `gpt-`) with no explicit --agent-type → `copilot`
 *   - Explicit `--agent-type claude-code` with a non-Claude model → deduplicated sentinel job
 *   - Everything else → `auth0-ReAct-agent` (or the explicitly requested type)
 * Exported so the routing logic can be unit-tested independently of the CLI.
 */
export function buildJobList(
  registry: EvalConfig[],
  models: string[],
  modes: Mode[],
  tools: string[],
  agentType: AgentType | undefined,
  matrix = false,
): Array<[EvalConfig, string, Mode, string[], AgentType]> {
  const isClaudeModel = (m: string) => m.startsWith('claude-');
  const isGeminiModel = (m: string) => m.startsWith('gemini-');
  const isGptModel = (m: string) => m.startsWith('gpt-');
  const jobs: Array<[EvalConfig, string, Mode, string[], AgentType]> = [];
  const claudeCodeEvalsSeen = new Set<string>();
  // In matrix mode iterate over all tool-set combinations for agent jobs (skills, mcp+skills).
  // In normal mode wrap the single tools array so the inner loop is uniform.
  const agentToolSets = matrix && tools.length === 0 ? MATRIX_TOOL_SETS : [tools];
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
                ? 'copilot'
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
          } else {
            jobs.push([evalCfg, model, mode, jobTools, effectiveAgentType]);
          }
        }
      }
    }
  }
  return jobs;
}

async function main(): Promise<void> {
  const config = parseRunConfig(process.argv);
  const {
    models,
    modes,
    matrix,
    tools,
    evalIds,
    workers,
    outputPath: outputOverride,
    keepWorkspace,
    braintrust,
    apiKey,
    agentType,
  } = config;

  const registry = evalIds.length > 0 ? EVALUATIONS.filter((e) => evalIds.includes(e.id)) : EVALUATIONS;

  if (registry.length === 0) {
    logger.error('No evals to run. Check your --eval flag.');
    process.exit(1);
  }

  const jobs = buildJobList(registry, models, modes, tools, agentType, matrix);

  // ── Subprocess-per-job parallelism ──────────────────────────────────────────
  // Spawn one child process per (eval × model × mode × tools) job so a crash
  // or memory leak in one job cannot affect the others.  Each subprocess
  // receives explicit --eval, --model, --mode, --tools, --agent-type flags so
  // it resolves to exactly one job and takes the single-job path below, writing
  // its result to a per-job temp file.  The parent waits for all subprocesses
  // (up to `workers` concurrently) then merges the temp files into the final
  // output.
  if (jobs.length > 1) {
    const { spawnEval, mergeIntoOutput } = await import('./runners/subprocess-runner.js');
    const selfPath = join(__dirname, 'run.js');
    const outputPath = resolveOutputPath(FRAMEWORK_ROOT, matrix ? ['matrix'] : modes, outputOverride);

    // Strip all per-job flags — each subprocess gets its own explicit values.
    // --matrix is also stripped: the matrix has already been expanded into jobs.
    const baseArgs = buildSubprocessArgs();

    const tempFiles: string[] = [];
    const subLimit = pLimit(workers);
    const settled = await Promise.allSettled(
      jobs.map(([evalCfg, model, mode, jobTools, jobAgentType]) =>
        subLimit(async () => {
          const toolsSuffix = jobTools.length > 0 ? `-${jobTools.join('+')}` : '';
          const safeModel = model.replace(/[^a-zA-Z0-9.-]/g, '_');
          const tempFile = join(FRAMEWORK_ROOT, `scores-tmp-${evalCfg.id}-${safeModel}-${mode}${toolsSuffix}.json`);
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
  const BT_PROJECT_ID = '38395851-dd41-46ec-a971-a30402db6921';
  const BT_DATASET_NAME = 'auth0-evals';

  let btReporter: Awaited<ReturnType<typeof import('@a0/eval-reporter').createBraintrustReporter>> = null;
  if (braintrust) {
    const { createBraintrustReporter } = await import('@a0/eval-reporter');
    const modeLabel = matrix ? 'matrix' : modes.join(',');
    btReporter = await createBraintrustReporter(modeLabel, tools, { projectId: BT_PROJECT_ID });

    const { syncDataset, toEvalSummaries } = await import('@a0/eval-reporter');
    Promise.all(registry.map((cfg) => loadEval(cfg, FRAMEWORK_ROOT)))
      .then((evalDefs) => syncDataset(toEvalSummaries(evalDefs), { projectId: BT_PROJECT_ID, datasetName: BT_DATASET_NAME }))
      .catch((e) => logger.error(`[Braintrust] Dataset sync error: ${e}`));
  }

  const results: JobResult[] = [];
  const tStart = Date.now();

  const limit = pLimit(workers);
  await Promise.all(
    jobs.map(([evalCfg, model, mode, jobTools, jobAgentType]) =>
      limit(async () => {
        try {
          const result = await runJob(evalCfg, model, mode, jobTools, apiKey, keepWorkspace, jobAgentType);
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

  const outputPath = resolveOutputPath(FRAMEWORK_ROOT, matrix ? ['matrix'] : modes, outputOverride);
  const existing = loadResults(outputPath);
  const merged = mergeResults(existing, results);
  saveResults(outputPath, merged);
  logger.info(`\n[Output] Results saved to: ${outputPath}`);

  const errorResults = results.filter((r) => r.status === 'error');
  if (errorResults.length > 0) {
    process.exit(1);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
if (!process.env.VITEST) {
  main().catch((e) => {
    logger.error(e);
    process.exit(1);
  });
}
