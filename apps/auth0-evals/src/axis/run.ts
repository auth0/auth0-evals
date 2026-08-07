/**
 * Entry point for the auth0-evals AXIS integration.
 *
 * Loads the auth0-evals framework config, then delegates to runAxis() which
 * runs AXIS and layers our graders on top of every job result.
 *
 * After the run, writes scores-axis.json (same format as scores-agent.json)
 * and auto-generates report-axis.html using the existing evals reporter.
 *
 * Usage:
 *   npm run axis
 */

/* eslint-disable no-console */

import { runAxis, buildAxisScores } from '@a0/evals-axis';
import { setFrameworkConfig, loadConfig } from '@a0/evals-core';
import { renderHtml } from '@a0/evals-reporter';
import { config as loadDotenv } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the app root from the compiled output location:
// apps/auth0-evals/dist/axis/run.js → ../../ = apps/auth0-evals/
const APP_ROOT = join(__dirname, '..', '..');

// Load .env before anything else so all downstream code sees the vars.
loadDotenv({ path: join(APP_ROOT, '.env') });

// Bridge auth0-evals env vars to the names AXIS's claude-code adapter expects.
// AXIS checks for ANTHROPIC_API_KEY at startup; our .env uses LLM_API_KEY.
if (!process.env.ANTHROPIC_API_KEY && process.env.LLM_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.LLM_API_KEY;
}
// Use the proxy base URL directly — appending /anthropic forwards the key
// straight to Anthropic which rejects non-Anthropic keys in CI.
if (!process.env.ANTHROPIC_BASE_URL && process.env.CLAUDE_PROXY_BASE_URL) {
  process.env.ANTHROPIC_BASE_URL = process.env.CLAUDE_PROXY_BASE_URL.replace(/\/$/, '');
}

// Load auth0-evals framework config so runGraders() has access to judge model,
// proxy URL, and other settings via the singleton.
const frameworkConfig = await loadConfig({
  configPath: join(APP_ROOT, 'eval.config.js'),
});
setFrameworkConfig(frameworkConfig);

// runGraders() uses config.proxy.baseUrl (the LiteLLM proxy) for judge calls,
// not ANTHROPIC_BASE_URL. No model-ID remapping needed — the framework config's
// judge model (e.g. 'claude-opus-4-8') is what LiteLLM expects. Passing no
// judgeModel here lets runGraders() fall back to config.judge.model.
const { scoredOutput, graderResults } = await runAxis({
  configPath: join(APP_ROOT, 'axis.config.ts'),
  frameworkRoot: APP_ROOT,
  apiKey: process.env.LLM_API_KEY ?? '',
});

console.log(
  `[axis] Done — ${scoredOutput.summary.completed}/${scoredOutput.summary.total} completed` +
    (scoredOutput.summary.failed > 0 ? `, ${scoredOutput.summary.failed} failed` : ''),
);

// Write scores-axis.json and report-axis.html so results appear in npm run report.
const scores = buildAxisScores(scoredOutput, graderResults);
const scoresPath = join(APP_ROOT, 'scores-axis.json');
writeFileSync(scoresPath, JSON.stringify(scores, null, 2), 'utf-8');
console.log(`[axis] Scores: ${scoresPath}`);

const now = new Date();
const generatedAt =
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` +
  ` ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
const reportPath = join(APP_ROOT, 'report-axis.html');
// renderHtml's input type is Record<string, unknown>[] — a loose signature that
// predates the typed JobResult union. AgentJobResult is structurally compatible
// but TypeScript rejects the direct assignment due to the index signature gap,
// so the double cast is intentional rather than masking a real type mismatch.
writeFileSync(reportPath, renderHtml(scores as unknown as Record<string, unknown>[], generatedAt), 'utf-8');
console.log(`[axis] Report: ${reportPath}`);
