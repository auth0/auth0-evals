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
 *   --eval      Eval ID to run (default: all). Can be repeated.
 *   --model     Model(s) to run (default: gpt-5.2). Can be repeated.
 *               Use 'all' to run all known working models.
 *   --mode      Execution mode: baseline | agent | all (default: baseline)
 *   --tools     Tools to inject for agent mode: skills, mcp (default: none). Case-insensitive. Supports {skills} and skills,mcp,... syntax.
 *   --workers   Parallel workers (default: 4)
 *   --output    JSON output path (default: scores-<mode>.json)
 *   --keep-workspace   (agent mode) Keep temp workspace after run
 *   --braintrust       Log results to Braintrust experiment (requires BRAINTRUST_API_KEY)
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import pLimit from 'p-limit';
import { config as loadDotenv } from 'dotenv';
import { EVALUATIONS, type EvalConfig } from './config/evaluations.js';
import { UnknownModeError } from './errors.js';
import { loadEval, type EvalDefinition } from './runners/loader.js';
import { runGraders, GraderLevel } from './agent_eval/graders.js';
import { serialiseBaseline, serialiseAgent, serialiseError } from './runners/serializers.js';
import { mergeResults, loadResults, saveResults, resolveOutputPath } from './persistence/results.js';
import { parseRunConfig } from './cli/config.js';
import type { JobResult } from './types/results.js';

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
  parseToolsArg,
  type Mode,
} from './cli/constants.js';
import type { Mode } from './cli/constants.js';

const BASELINE_LEVELS = new Set([GraderLevel.L1, GraderLevel.L2, GraderLevel.L3]);

// ── Per-job execution ─────────────────────────────────────────────────────────

export async function runJob(
  evalConfig: EvalConfig,
  model: string,
  mode: Mode,
  tools: string[],
  apiKey: string,
  keepWorkspace = false,
): Promise<JobResult> {
  const evalDef = await loadEval(evalConfig, FRAMEWORK_ROOT);
  console.log(`  [${mode}] ${evalDef.id} / ${model}`);

  try {
    if (mode === 'baseline') {
      const { runBaseline } = await import('./runners/baseline.js');
      const result = await runBaseline(apiKey, model, evalDef);
      const graderResults = await gradeText(evalDef, result.responseText, apiKey, BASELINE_LEVELS);
      return serialiseBaseline(evalDef, result, graderResults, result.responseText);
    } else if (mode === 'agent') {
      let evalToRun = evalDef;
      if (tools.some((t) => t.toLowerCase() === 'skills')) {
        const { augmentWithSkills } = await import('./runners/skills.js');
        evalToRun = await augmentWithSkills(evalDef);
      }
      return await runAgentJob(evalToRun, model, mode, tools, apiKey, keepWorkspace);
    } else {
      throw new UnknownModeError(mode);
    }
  } catch (e) {
    const errorMsg = String(e);
    console.log(`  ✗ [${evalDef.id}] ${model} - ERROR: ${errorMsg.slice(0, 100)}`);
    return serialiseError(evalDef.id, evalDef.category, model, mode, tools, errorMsg);
  }
}

export function extractCodeBlocks(text: string): string {
  const blocks = [...text.matchAll(/^[ \t]{0,3}```[^\r\n]*\r?\n([\s\S]*?)^[ \t]{0,3}```[ \t]*\r?$/gm)].map((m) => m[1]);
  if (blocks.length > 0) {
    return blocks.join('\n\n');
  }
  const openingFenceMatch = /^[ \t]{0,3}```[^\r\n]*\r?\n/m.exec(text);
  if (openingFenceMatch) {
    return text.slice(openingFenceMatch.index + openingFenceMatch[0].length);
  }
  return text;
}

async function gradeText(
  evalDef: EvalDefinition,
  text: string,
  apiKey: string,
  allowedLevels?: Set<GraderLevel>,
): Promise<Awaited<ReturnType<typeof runGraders>>> {
  const code = extractCodeBlocks(text);
  const tmp = mkdtempSync(join(tmpdir(), 'auth0_eval_grade_'));
  try {
    writeFileSync(join(tmp, 'llm_response.txt'), code, 'utf-8');
    return await runGraders(evalDef.graders, tmp, apiKey, undefined, allowedLevels);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function runAgentJob(
  evalDef: EvalDefinition,
  model: string,
  mode: 'agent',
  tools: string[],
  apiKey: string,
  keepWorkspace: boolean,
): Promise<JobResult> {
  const { runAgent, setupWorkspace, cleanupWorkspace } = await import('./agent_eval/agent.js');
  const { score } = await import('./agent_eval/scorer.js');

  const workspace = setupWorkspace(evalDef.scaffold);
  try {
    const taskAdapter = {
      name: evalDef.id,
      agentSystemPrompt: evalDef.agentSystemPrompt,
      userPrompt: evalDef.userPrompt,
    };

    const record = await runAgent(apiKey, model, taskAdapter, workspace, undefined, tools);

    let graderResults: Awaited<ReturnType<typeof runGraders>> = [];
    if (evalDef.graders.length > 0) {
      graderResults = await runGraders(evalDef.graders, workspace, apiKey);
    }

    const scored = score(record, undefined, graderResults);
    return serialiseAgent(evalDef, record, scored, graderResults, model, mode, tools);
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
    console.log(
      `  ✓ [${r.eval_id}] ${r.model}  grade=${r.overall_grade} (${r.overall_score.toFixed(0)})  ` +
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
  } = config;

  const registry = evalIds.length > 0 ? EVALUATIONS.filter((e) => evalIds.includes(e.id)) : EVALUATIONS;

  if (registry.length === 0) {
    console.error('No evals to run. Check your --eval flag.');
    process.exit(1);
  }

  const jobs: [EvalConfig, string, Mode, string[]][] = [];
  for (const evalCfg of registry) {
    for (const model of models) {
      for (const mode of modes) {
        jobs.push([evalCfg, model, mode, mode === 'agent' ? tools : []]);
      }
    }
  }

  console.log(`\nRunning ${jobs.length} job(s)  modes=${JSON.stringify(modes)}  workers=${workers}`);
  console.log(`Evals : ${JSON.stringify(registry.map((e) => e.id))}`);
  console.log(`Models: ${JSON.stringify(models)}`);
  console.log(`Modes : ${JSON.stringify(modes)}\n`);

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
    jobs.map(([evalCfg, model, mode, jobTools]) =>
      limit(async () => {
        try {
          const result = await runJob(evalCfg, model, mode, jobTools, apiKey, keepWorkspace);
          results.push(result);
          printResult(result);
          btReporter?.log(result);
        } catch (exc) {
          console.log(`  [ERROR] ${evalCfg.id}/${model}/${mode}: ${exc}`);
          const errResult = serialiseError(evalCfg.id, evalCfg.category, model, mode, jobTools, String(exc));
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
