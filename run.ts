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
 *   --mode      Execution mode: baseline | agent | agent+skills | all (default: baseline)
 *               Use 'all' to run all three modes.
 *   --workers   Parallel workers (default: 4)
 *   --output    JSON output path (default: scores-<mode>.json)
 *   --keep-workspace   (agent mode) Keep temp workspace after run
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import pLimit from 'p-limit';
import { config as loadDotenv } from 'dotenv';
import { EVALUATIONS, type EvalConfig } from './config/evaluations.js';
import { UnknownModeError } from './errors.js';
import { loadEval, type EvalDefinition } from './runners/loader.js';
import { runGraders } from './agent_eval/graders.js';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRAMEWORK_ROOT = basename(__dirname) === 'dist' ? join(__dirname, '..') : __dirname;

// Load .env
loadDotenv({ path: join(FRAMEWORK_ROOT, '.env') });

export const KNOWN_WORKING_MODELS = ['gpt-5.2', 'claude-4-6-sonnet', 'claude-4-6-opus', 'gemini-3-pro-preview'];

export const DEFAULT_MODEL = 'gpt-5.2';

export const ALL_MODES = ['baseline', 'agent', 'agent+skills'];

// Models that don't support agent mode.
const AGENT_INCOMPATIBLE_MODELS: string[] = [];

// ── Per-job execution ─────────────────────────────────────────────────────────

export async function runJob(
  evalConfig: EvalConfig,
  model: string,
  mode: string,
  apiKey: string,
  keepWorkspace = false,
): Promise<Record<string, unknown>> {
  const evalDef = await loadEval(evalConfig, FRAMEWORK_ROOT);
  console.log(`  [${mode}] ${evalDef.id} / ${model}`);

  try {
    if (mode === 'baseline') {
      const { runBaseline } = await import('./runners/baseline.js');
      const result = await runBaseline(apiKey, model, evalDef);
      const graderResults = await gradeText(evalDef, result.responseText, apiKey);
      return serialiseSimple(evalDef, result, graderResults);
    } else if (mode === 'agent') {
      return await runAgentJob(evalDef, model, mode, apiKey, keepWorkspace);
    } else if (mode === 'agent+skills') {
      const { augmentWithSkills } = await import('./runners/skills.js');
      const augmented = await augmentWithSkills(evalDef);
      return await runAgentJob(augmented, model, mode, apiKey, keepWorkspace);
    } else {
      throw new UnknownModeError(mode);
    }
  } catch (e) {
    const errorMsg = String(e);
    console.log(`  ✗ [${evalDef.id}] ${model} - ERROR: ${errorMsg.slice(0, 100)}`);
    return {
      eval_id: evalDef.id,
      model,
      mode,
      status: 'error',
      error: errorMsg,
      wall_time: 0,
      tokens: 0,
      cost_usd: 0,
    };
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
): Promise<Awaited<ReturnType<typeof runGraders>>> {
  const code = extractCodeBlocks(text);
  const tmp = mkdtempSync(join(tmpdir(), 'auth0_eval_grade_'));
  try {
    writeFileSync(join(tmp, 'llm_response.txt'), code, 'utf-8');
    return await runGraders(evalDef.graders, tmp, apiKey);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function runAgentJob(
  evalDef: EvalDefinition,
  model: string,
  mode: string,
  apiKey: string,
  keepWorkspace: boolean,
): Promise<Record<string, unknown>> {
  const { runAgent, setupWorkspace, cleanupWorkspace } = await import('./agent_eval/agent.js');
  const { score } = await import('./agent_eval/scorer.js');

  const workspace = setupWorkspace(evalDef.scaffold);
  try {
    const taskAdapter = {
      name: evalDef.id,
      agentSystemPrompt: evalDef.agentSystemPrompt,
      userPrompt: evalDef.userPrompt,
    };

    const record = await runAgent(apiKey, model, taskAdapter, workspace);

    let graderResults: Awaited<ReturnType<typeof runGraders>> = [];
    if (evalDef.graders.length > 0) {
      graderResults = await runGraders(evalDef.graders, workspace, apiKey);
    }

    const scored = score(record, undefined, graderResults);

    return {
      eval_id: evalDef.id,
      model,
      mode,
      session_id: record.sessionId,
      status: record.status,
      overall_score: scored.overallScore,
      overall_grade: scored.overallGrade,
      grader_pass_rate: scored.graderPassRate,
      wall_time: record.endTime - record.startTime,
      active_time: record.toolCalls.reduce((sum, tc) => sum + (tc.endTime - tc.startTime), 0),
      tool_calls: record.toolCalls.length,
      interruptions: record.toolCalls.filter((tc) => tc.isInterruption).length,
      tokens: record.inputTokens + record.outputTokens,
      cost_usd: record.costUsd,
      dimensions: scored.dimensions.map((d) => ({
        name: d.name,
        score: d.rawScore,
        grade: d.grade,
        weight: d.weight,
        weighted: d.weighted,
      })),
      graders: graderResults.map((gr) => ({
        name: gr.name,
        kind: gr.kind,
        passed: gr.passed,
      })),
    };
  } finally {
    if (!keepWorkspace) {
      cleanupWorkspace(workspace);
    }
  }
}

function serialiseSimple(
  evalDef: EvalDefinition,
  result: {
    evalId: string;
    model: string;
    mode: string;
    sessionId: string;
    status: string;
    wallTime: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    error?: string;
  },
  graderResults: { name: string; kind: string; passed: boolean; detail: string }[],
): Record<string, unknown> {
  const passed = graderResults.filter((r) => r.passed).length;
  const total = graderResults.length;
  const rate = total > 0 ? passed / total : 1.0;
  return {
    eval_id: evalDef.id,
    model: result.model,
    mode: result.mode,
    session_id: result.sessionId,
    status: result.status,
    grader_pass_rate: rate,
    graders_passed: passed,
    graders_total: total,
    wall_time: result.wallTime,
    tokens: result.inputTokens + result.outputTokens,
    cost_usd: result.costUsd,
    error: result.error ?? '',
    graders: graderResults.map((gr) => ({
      name: gr.name,
      kind: gr.kind,
      passed: gr.passed,
      detail: gr.detail,
    })),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function printResult(r: Record<string, unknown>): void {
  const mode = r.mode ?? '?';
  if (mode === 'agent' || mode === 'agent+skills') {
    const grade = r.overall_grade ?? '?';
    const sc = r.overall_score ?? 0;
    const rate = (r.grader_pass_rate as number) ?? 0;
    console.log(
      `  ✓ [${r.eval_id}] ${r.model}  grade=${grade} (${Number(sc).toFixed(0)})  ` +
        `graders=${(rate * 100).toFixed(0)}%  $${Number(r.cost_usd ?? 0).toFixed(4)}`,
    );
  } else {
    const passed = r.graders_passed ?? '?';
    const total = r.graders_total ?? '?';
    const rate = (r.grader_pass_rate as number) ?? 0;
    console.log(
      `  ✓ [${r.eval_id}] ${r.model}  graders=${passed}/${total} ` +
        `(${(rate * 100).toFixed(0)}%)  $${Number(r.cost_usd ?? 0).toFixed(4)}`,
    );
  }
}

function printSummary(results: Record<string, unknown>[], elapsed: number): void {
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
      console.log(`    ${r.eval_id}/${r.model}: ${r.error ?? ''}`);
    }
  }
  console.log('='.repeat(60));
}

async function main(): Promise<void> {
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
    .option('--mode <mode>', 'Execution mode: baseline | agent | agent+skills | all (default: baseline)', 'baseline')
    .option('--workers <n>', 'Parallel workers (default: 4)', '4')
    .option('--output <path>', 'JSON output path')
    .option('--keep-workspace', '(agent mode) Keep temp workspace after run', false);

  program.parse(process.argv);
  const opts = program.opts();

  const apiKey = process.env.ATKO_API_KEY;
  if (!apiKey) {
    console.error('Error: ATKO_API_KEY environment variable not set.');
    process.exit(1);
  }

  // Handle model selection
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

  // Handle mode selection
  const modeArg = opts.mode as string;
  let modes: string[];
  if (modeArg === 'all') {
    modes = ALL_MODES;
    console.log(`Running all modes: ${modes.join(', ')}`);
  } else {
    if (!ALL_MODES.includes(modeArg)) {
      console.error(`Invalid mode: ${modeArg}. Choose from: ${ALL_MODES.join(', ')} or 'all'`);
      process.exit(1);
    }
    modes = [modeArg];
  }

  // Filter evals
  const evalIds = opts.eval as string[];
  let registry = EVALUATIONS;
  if (evalIds.length > 0) {
    registry = EVALUATIONS.filter((e) => evalIds.includes(e.id));
    const unknown = evalIds.filter((id) => !EVALUATIONS.some((e) => e.id === id));
    if (unknown.length > 0) {
      console.error(`Unknown eval(s): ${unknown.join(', ')}`);
      process.exit(1);
    }
  }

  if (registry.length === 0) {
    console.error('No evals to run. Check your --eval flag.');
    process.exit(1);
  }

  // Build job list
  const jobs: [EvalConfig, string, string][] = [];
  for (const evalCfg of registry) {
    for (const model of models) {
      for (const mode of modes) {
        if ((mode === 'agent' || mode === 'agent+skills') && AGENT_INCOMPATIBLE_MODELS.includes(model)) continue;
        jobs.push([evalCfg, model, mode]);
      }
    }
  }

  const skipped = registry.length * models.length * modes.length - jobs.length;
  console.log(`\nRunning ${jobs.length} job(s)  modes=${JSON.stringify(modes)}  workers=${opts.workers}`);
  if (skipped > 0) console.log(`Skipped ${skipped} job(s) (agent-incompatible models)`);
  console.log(`Evals : ${JSON.stringify(registry.map((e) => e.id))}`);
  console.log(`Models: ${JSON.stringify(models)}`);
  console.log(`Modes : ${JSON.stringify(modes)}\n`);

  const results: Record<string, unknown>[] = [];
  const tStart = Date.now();

  const limit = pLimit(parseInt(opts.workers, 10) || 4);
  await Promise.all(
    jobs.map(([evalCfg, model, mode]) =>
      limit(async () => {
        try {
          const result = await runJob(evalCfg, model, mode, apiKey, opts.keepWorkspace as boolean);
          results.push(result);
          printResult(result);
        } catch (exc) {
          console.log(`  [ERROR] ${evalCfg.id}/${model}/${mode}: ${exc}`);
          results.push({ eval_id: evalCfg.id, model, mode, status: 'error', error: String(exc) });
        }
      }),
    ),
  );

  const elapsed = (Date.now() - tStart) / 1000;
  printSummary(results, elapsed);

  // Determine output path
  let outputPath = opts.output as string | undefined;
  if (!outputPath) {
    outputPath = modes.length > 1 ? 'scores-all-modes.json' : `scores-${modes[0]}.json`;
  }
  outputPath = join(FRAMEWORK_ROOT, outputPath);

  // Deduplicate and merge with existing
  const deduped = Object.values(Object.fromEntries(results.map((r) => [`${r.eval_id}|${r.model}|${r.mode}`, r])));
  const newKeys = new Set(deduped.map((r) => `${r.eval_id}|${r.model}|${r.mode}`));

  let existing: Record<string, unknown>[] = [];
  if (existsSync(outputPath)) {
    try {
      const loaded = JSON.parse(readFileSync(outputPath, 'utf-8')) as unknown;
      if (Array.isArray(loaded)) {
        existing = (loaded as Record<string, unknown>[]).filter(
          (r) => typeof r === 'object' && r !== null && 'eval_id' in r && 'model' in r,
        );
      }
    } catch {
      // ignore
    }
  }

  const merged = [...existing.filter((r) => !newKeys.has(`${r.eval_id}|${r.model}|${r.mode}`)), ...deduped];

  writeFileSync(outputPath, JSON.stringify(merged, null, 2), 'utf-8');
  console.log(`\n[Output] Results saved to: ${outputPath}`);
}

// Skip main() when running under Vitest (process.env.VITEST is set automatically)
if (!process.env.VITEST) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
