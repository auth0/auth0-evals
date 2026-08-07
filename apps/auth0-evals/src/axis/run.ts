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
 *   npm run axis -- --eval react_quickstart --agent claude-code --model claude-sonnet-5
 *   npm run axis -- --output /tmp/scores.json --debug
 */

/* eslint-disable no-console */

import { runAxis, buildAxisScores } from '@a0/evals-axis';
import { setFrameworkConfig, loadConfig } from '@a0/evals-core';
import { renderHtml } from '@a0/evals-reporter';
import { config as loadDotenv } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the app root from the compiled output location:
// apps/auth0-evals/dist/axis/run.js → ../../ = apps/auth0-evals/
const APP_ROOT = join(__dirname, '..', '..');

// Load .env before anything else so all downstream code sees the vars.
loadDotenv({ path: join(APP_ROOT, '.env') });

// Parse CLI flags. Values are merged into process.env so axis.config.ts picks
// them up when AXIS loads it inside run(). Flags take precedence over env vars.
//
//   --eval react_quickstart          filter to one scenario (repeatable)
//   --agent codex                    filter to one agent (repeatable)
//   --workers 4                      parallel job limit
//   --model claude-sonnet-5          override model for all configured agents
//   --output /path/scores.json       where to write scores-axis.json (default: APP_ROOT)
//   --debug                          capture raw adapter stdout for debugging
//
// Examples:
//   npm run axis -- --eval react_quickstart
//   npm run axis -- --eval react_quickstart --agent codex --workers 2
//   npm run axis -- --agent claude-code --model claude-sonnet-5
const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    eval: { type: 'string', multiple: true, short: 'e' },
    agent: { type: 'string', multiple: true, short: 'a' },
    workers: { type: 'string', short: 'w' },
    model: { type: 'string', short: 'm' },
    output: { type: 'string', short: 'o' },
    debug: { type: 'boolean' },
  },
  strict: false,
});

if (flags.eval?.length) process.env.AXIS_EVAL = flags.eval.join(',');
if (flags.agent?.length) process.env.AXIS_AGENT = flags.agent.join(',');
if (typeof flags.workers === 'string') process.env.AXIS_WORKERS = flags.workers;
if (typeof flags.model === 'string') process.env.AXIS_MODEL = flags.model;

// Bridge auth0-evals env vars to the names each AXIS adapter expects.
// AXIS always passes through the default API key vars (ANTHROPIC_API_KEY,
// CODEX_API_KEY, GEMINI_API_KEY) but filters out everything else — base URL
// vars must be listed in axis.config.ts's `env` array to reach the CLI.

// claude-code: AXIS checks ANTHROPIC_API_KEY; our .env uses LLM_API_KEY.
if (!process.env.ANTHROPIC_API_KEY && process.env.LLM_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.LLM_API_KEY;
}
// Use the proxy base URL directly — appending /anthropic forwards the key
// straight to Anthropic which rejects non-Anthropic keys in CI.
if (!process.env.ANTHROPIC_BASE_URL && process.env.CLAUDE_PROXY_BASE_URL) {
  process.env.ANTHROPIC_BASE_URL = process.env.CLAUDE_PROXY_BASE_URL.replace(/\/$/, '');
}

// codex: AXIS checks CODEX_API_KEY; the codex CLI reads OPENAI_BASE_URL
// (OpenAI SDK convention) for the proxy endpoint, appended with /v1.
if (!process.env.CODEX_API_KEY && process.env.LLM_API_KEY) {
  process.env.CODEX_API_KEY = process.env.LLM_API_KEY;
}
if (!process.env.OPENAI_BASE_URL) {
  const codexBase = process.env.CODEX_PROXY_BASE_URL ?? process.env.LLM_PROXY_BASE_URL;
  if (codexBase) {
    const normalized = codexBase.replace(/\/+$/, '');
    process.env.OPENAI_BASE_URL = normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
  }
}

// gemini: AXIS checks GEMINI_API_KEY; the Gemini CLI reads GOOGLE_GEMINI_BASE_URL.
if (!process.env.GEMINI_API_KEY && process.env.LLM_API_KEY) {
  process.env.GEMINI_API_KEY = process.env.LLM_API_KEY;
}
if (!process.env.GOOGLE_GEMINI_BASE_URL) {
  const geminiBase = process.env.GEMINI_PROXY_BASE_URL ?? process.env.LLM_PROXY_BASE_URL;
  if (geminiBase) {
    process.env.GOOGLE_GEMINI_BASE_URL = geminiBase.replace(/\/+$/, '');
  }
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
  ...(flags.debug === true ? { debug: true } : {}),
});

console.log(
  `[axis] Done — ${scoredOutput.summary.completed}/${scoredOutput.summary.total} completed` +
    (scoredOutput.summary.failed > 0 ? `, ${scoredOutput.summary.failed} failed` : ''),
);

// Write scores-axis.json and report-axis.html so results appear in npm run report.
const scores = buildAxisScores(scoredOutput, graderResults);
const scoresPath = typeof flags.output === 'string' ? flags.output : join(APP_ROOT, 'scores-axis.json');
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
