/**
 * Programmatic AXIS runner with auth0-evals grader overlay.
 *
 * Wraps AXIS's run() with an onResult hook that fires the auth0-evals grader
 * engine after each job completes (before workspace teardown), then calls
 * scoreResults() to compute AXIS's own 4-dimension LLM-judge scores.
 */

/* eslint-disable no-console */

import { run, scoreResults } from '@netlify/axis';
import type { ScoredOutput } from '@netlify/axis';
import type { GraderResult } from '@a0/evals-graders';
import { runAuth0Graders } from './grader-hook.js';
import type { RunAuth0GradersOptions } from './grader-hook.js';

export interface RunAxisOptions extends RunAuth0GradersOptions {
  /** Path to axis.config.ts. Defaults to axis.config.ts in the current directory. */
  configPath?: string;
  /** Called with auth0-evals grader results after each job. Defaults to console logging. */
  onGraderResults?: (scenarioKey: string, agentName: string, results: GraderResult[]) => void;
  /** Called with the AXIS score after scoring completes for each result. Defaults to console logging. */
  onAxisScore?: (scenarioKey: string, agentName: string, score: ScoredOutput['results'][number]['score']) => void;
}

export interface RunAxisResult {
  /** AXIS scored output with goal/env/svc/agent scores for each result. */
  scoredOutput: ScoredOutput;
  /**
   * auth0-evals grader results collected during the run.
   * Keyed by "scenarioKey|agentName" — matches ScoredOutput.results entries.
   */
  graderResults: Map<string, GraderResult[]>;
}

/**
 * Runs AXIS, layers auth0-evals graders on top of every job result, then
 * scores all results with AXIS's LLM judge.
 *
 * Returns the full ScoredOutput so callers can persist or report the AXIS
 * scores alongside auth0-evals grader results.
 *
 * Call setFrameworkConfig() before this if you need custom judge / proxy
 * settings — runGraders() reads them via the framework config singleton.
 */
export async function runAxis(options: RunAxisOptions): Promise<RunAxisResult> {
  const { configPath, onGraderResults, onAxisScore, ...graderOptions } = options;

  // Collect grader results for each job so callers can build reports.
  const allGraderResults = new Map<string, GraderResult[]>();

  // Step 1: run agents, fire our grader hook after each job.
  const runOutput = await run({
    ...(configPath ? { configPath } : {}),
    onResult: async (result) => {
      try {
        const graderResults = await runAuth0Graders(result, graderOptions);
        allGraderResults.set(`${result.scenarioKey}|${result.agentName}`, graderResults);
        const reporter = onGraderResults ?? logGraderResults;
        reporter(result.scenarioKey, result.agentName, graderResults);
      } catch (err) {
        console.error(`[auth0-graders] Error grading ${result.scenarioKey}:`, err);
        // Store an explicit failure so callers can distinguish "grading crashed"
        // from "no graders configured" (which also produces an empty array).
        const errorResult: GraderResult = {
          name: 'grading-error',
          kind: 'error',
          passed: false,
          detail: `Grading failed: ${err instanceof Error ? err.message : String(err)}`,
        };
        const key = `${result.scenarioKey}|${result.agentName}`;
        allGraderResults.set(key, [errorResult]);
        const reporter = onGraderResults ?? logGraderResults;
        reporter(result.scenarioKey, result.agentName, [errorResult]);
      }
    },
  });

  // Step 2: score with AXIS's LLM judge (goal achievement + 3 process dimensions).
  // By default AXIS uses the agent's own model as judge (self-scoring).
  //
  // The runner's cleanup() deletes workingDirectory before run() returns, so
  // callJudge() must not try to use the now-deleted path as cwd. Strip it from
  // results so callJudge() falls back to creating a fresh temp workspace.
  console.log('[axis] Scoring results with AXIS judge...');
  const runOutputForScoring = {
    ...runOutput,
    results: runOutput.results.map((r) => ({ ...r, workingDirectory: undefined })),
  };
  const scoredOutput = await scoreResults(runOutputForScoring);

  for (const result of scoredOutput.results) {
    const reporter = onAxisScore ?? logAxisScore;
    reporter(result.scenarioKey, result.agentName, result.score);
  }

  return { scoredOutput, graderResults: allGraderResults };
}

function logGraderResults(scenarioKey: string, agentName: string, results: GraderResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  console.log(`[auth0-graders] ${scenarioKey} (${agentName}): ${passed}/${results.length} passed`);
  for (const r of results) {
    const icon = r.passed ? '✓' : '✗';
    const detail = r.detail ? ` — ${r.detail}` : '';
    console.log(`  ${icon} ${r.name}${detail}`);
  }
}

function logAxisScore(scenarioKey: string, agentName: string, score: ScoredOutput['results'][number]['score']): void {
  console.log(
    `[axis-score] ${scenarioKey} (${agentName}): ${score.axisScore.toFixed(1)}/100` +
      ` | goal=${score.goalAchievement.score.toFixed(1)}` +
      ` env=${score.environment.score.toFixed(1)}` +
      ` svc=${score.service.score.toFixed(1)}` +
      ` agent=${score.agent.score.toFixed(1)}`,
  );
}
