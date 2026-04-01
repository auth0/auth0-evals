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
 *   --agent-type  Agent runner for agent mode: auth0-ReAct-agent | claude-code (default: auth0-ReAct-agent)
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
import type { JobResult } from './types/results.js';
import { gradeText, BASELINE_LEVELS } from './runners/baseline.js';
import { copySkillsToWorkspace } from './runners/skills.js';

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
  parseToolsArg,
  type Mode,
  type AgentType,
} from './cli/constants.js';
import type { Mode, AgentType } from './cli/constants.js';
import { DEFAULT_AGENT_TYPE } from './cli/constants.js';

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
  console.log(`  [${mode}${agentLabel}] ${evalDef.id} / ${model}`);

  try {
    if (mode === 'baseline') {
      const { runBaseline } = await import('./runners/baseline.js');
      const result = await runBaseline(apiKey, model, evalDef);
      const graderResults = await gradeText(evalDef, result.responseText, apiKey, BASELINE_LEVELS);
      return serialiseBaseline(evalDef, result, graderResults, result.responseText);
    } else if (mode === 'agent') {
      let evalToRun = evalDef;
      if (tools.some((t) => t.toLowerCase() === 'skills') && agentType === DEFAULT_AGENT_TYPE) {
        const { augmentWithSkills } = await import('./runners/skills.js');
        evalToRun = await augmentWithSkills(evalDef);
      }
      return await runAgentJob(evalToRun, model, mode, tools, apiKey, keepWorkspace, agentType);
    } else {
      throw new UnknownModeError(mode);
    }
  } catch (e) {
    const errorMsg = String(e);
    console.log(`  ✗ [${evalDef.id}] ${model} - ERROR: ${errorMsg.slice(0, 100)}`);
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
  const { setupWorkspace, cleanupWorkspace } = await import('./agent_eval/react-agent.js');
  const { score } = await import('./agent_eval/scorer.js');

  const workspace = setupWorkspace(evalDef.scaffold);
  try {
    // ── Dispatch to the appropriate agent runner ──────────────────────────────
    let record: Awaited<ReturnType<typeof import('./agent_eval/react-agent.js').runAgent>>;
    let resolvedModel = model;

    if (agentType === 'claude-code') {
      const { runClaudeCodeAgent, CLAUDE_CODE_MODEL_ID } = await import('./agent_eval/claude-code-agent.js');
      // Copy skill files into the workspace so Claude Code can read them with native Read/Glob tools
      const evalForClaude = tools.includes('skills') ? await copySkillsToWorkspace(evalDef, workspace) : evalDef;
      // Only pass a real Claude model ID; the 'claude-code' sentinel is not a valid Anthropic model.
      const claudeModel = model !== CLAUDE_CODE_MODEL_ID && model.startsWith('claude-') ? model : undefined;
      record = await runClaudeCodeAgent(evalForClaude, workspace, { tools, model: claudeModel });
      resolvedModel = record.model ?? CLAUDE_CODE_MODEL_ID;
    } else {
      // auth0-ReAct-agent (default): custom ReAct loop via the ATKO LLM gateway
      const { runAgent } = await import('./agent_eval/react-agent.js');
      record = await runAgent(
        apiKey,
        model,
        { name: evalDef.id, agentSystemPrompt: evalDef.agentSystemPrompt, userPrompt: evalDef.userPrompt },
        workspace,
        undefined,
        tools,
      );
    }

    let graderResults: Awaited<ReturnType<typeof runGraders>> = [];
    if (evalDef.graders.length > 0) {
      graderResults = await runGraders(evalDef.graders, workspace, apiKey);
    }

    const scored = score(record, undefined, graderResults);
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
    console.log(
      `  ✓ [${r.eval_id}]${agentTag} ${r.model}  grade=${r.overall_grade} (${r.overall_score.toFixed(0)})  ` +
        `graders=${(r.grader_pass_rate * 100).toFixed(0)}%  $${r.cost_usd.toFixed(4)}`,
    );
  } else {
    console.log(
      `  ✓ [${r.eval_id}] ${r.model}  graders=${r.graders_passed}/${r.graders_total} ` +
        `(${(r.grader_pass_rate * 100).toFixed(0)}%)  $${r.cost_usd.toFixed(4)}`,
    );
  }
}

function printSummary(results: JobResult[], elapsed: number): void {
  console.log('\n' + '='.repeat(60));
  console.log(`  Summary — ${results.length} run(s)  (${elapsed.toFixed(1)}s total)`);
  console.log('='.repeat(60));
  const succeeded = results.filter((r) => r.status !== 'error' && r.status !== 'failure');
  const failed = results.filter((r) => r.status === 'error' || r.status === 'failure');
  console.log(`  Passed : ${succeeded.length}`);
  console.log(`  Failed : ${failed.length}`);
  const totalCost = results.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  console.log(`  Cost   : $${totalCost.toFixed(4)}`);
  if (failed.length > 0) {
    console.log('\n  Failures:');
    for (const r of failed) {
      const error = 'error' in r && typeof r.error === 'string' ? r.error : '';
      console.log(`    ${r.eval_id}/${r.model}: ${error}`);
    }
  }
  console.log('='.repeat(60));
}

// ── Job routing ───────────────────────────────────────────────────────────────

/**
 * Builds the flat list of (evalCfg, model, mode, tools, agentType) tuples to run.
 *
 * Auto-routing rules for agent mode:
 *   - Claude models (prefix `claude-`) with no explicit --agent-type → `claude-code`
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
): Array<[EvalConfig, string, Mode, string[], AgentType]> {
  const isClaudeModel = (m: string) => m.startsWith('claude-');
  const jobs: Array<[EvalConfig, string, Mode, string[], AgentType]> = [];
  const claudeCodeEvalsSeen = new Set<string>();
  for (const evalCfg of registry) {
    for (const model of models) {
      for (const mode of modes) {
        if (mode !== 'agent') {
          jobs.push([evalCfg, model, mode, [], agentType ?? DEFAULT_AGENT_TYPE]);
          continue;
        }
        const effectiveAgentType: AgentType =
          !agentType && isClaudeModel(model) ? 'claude-code' : (agentType ?? DEFAULT_AGENT_TYPE);
        if (effectiveAgentType === 'claude-code') {
          if (isClaudeModel(model)) {
            jobs.push([evalCfg, model, mode, tools, effectiveAgentType]);
          } else {
            if (claudeCodeEvalsSeen.has(evalCfg.id)) continue;
            claudeCodeEvalsSeen.add(evalCfg.id);
            jobs.push([evalCfg, 'claude-code', mode, tools, effectiveAgentType]);
          }
        } else {
          jobs.push([evalCfg, model, mode, tools, effectiveAgentType]);
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
    tools,
    evalIds,
    workers,
    outputPath: outputOverride,
    keepWorkspace,
    braintrust,
    apiKey,
    modeArg,
    agentType,
  } = config;

  const registry = evalIds.length > 0 ? EVALUATIONS.filter((e) => evalIds.includes(e.id)) : EVALUATIONS;

  if (registry.length === 0) {
    console.error('No evals to run. Check your --eval flag.');
    process.exit(1);
  }

  const jobs = buildJobList(registry, models, modes, tools, agentType);

  console.log(`\nRunning ${jobs.length} job(s)  modes=${JSON.stringify(modes)}  workers=${workers}`);
  console.log(`Evals : ${JSON.stringify(registry.map((e) => e.id))}`);
  console.log(`Models: ${JSON.stringify(models)}`);
  console.log(`Modes : ${JSON.stringify(modes)}`);
  if (modes.includes('agent')) console.log(`Agent : ${agentType}`);
  console.log();

  // Braintrust experiment tracking (opt-in via --braintrust flag)
  let btReporter: Awaited<ReturnType<typeof import('./reporters/braintrust.js').createBraintrustReporter>> = null;
  if (braintrust) {
    const { createBraintrustReporter } = await import('./reporters/braintrust.js');
    btReporter = await createBraintrustReporter(modeArg, tools);

    // Sync eval definitions to Braintrust dataset (fire-and-forget, non-blocking)
    const { syncDataset, toEvalSummaries } = await import('./reporters/braintrust-dataset.js');
    Promise.all(registry.map((cfg) => loadEval(cfg, FRAMEWORK_ROOT)))
      .then((evalDefs) => syncDataset(toEvalSummaries(evalDefs)))
      .catch((e) => console.error(`[Braintrust] Dataset sync error: ${e}`));
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
          console.log(`  [ERROR] ${evalCfg.id}/${model}/${mode}: ${exc}`);
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

  const outputPath = resolveOutputPath(FRAMEWORK_ROOT, modes, outputOverride);
  const existing = loadResults(outputPath);
  const merged = mergeResults(existing, results);
  saveResults(outputPath, merged);
  console.log(`\n[Output] Results saved to: ${outputPath}`);
}

// Skip main() when running under Vitest (process.env.VITEST is set automatically)
if (!process.env.VITEST) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
