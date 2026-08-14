/**
 * Entry point for the auth0-evals AXIS integration.
 *
 * Loads the auth0-evals framework config, then delegates to runAxis() which
 * runs AXIS and layers our graders on top of every job result.
 *
 * After the run, writes scores-axis.json (same format as scores-agent.json)
 * and auto-generates report-axis.html using @netlify/axis's generateReportHtml().
 *
 * Usage:
 *   npm run axis
 *   npm run axis -- --eval react_quickstart --agent claude-code --model claude-sonnet-5
 *   npm run axis -- --output /tmp/scores.json --debug
 */

/* eslint-disable no-console */

import { runAxis, buildAxisScores, buildReportManifest } from '@a0/evals-axis';
import { setFrameworkConfig, loadConfig, discoverEvals } from '@a0/evals-core';
import { generateReportHtml } from '@netlify/axis';
import { config as loadDotenv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  process.env.ANTHROPIC_BASE_URL = process.env.CLAUDE_PROXY_BASE_URL.replace(/\/+$/, '');
}

// codex: AXIS checks CODEX_API_KEY; the codex CLI reads OPENAI_API_KEY.
// Both names are set so auth works regardless of which env var codex uses.
if (!process.env.CODEX_API_KEY && process.env.LLM_API_KEY) {
  process.env.CODEX_API_KEY = process.env.LLM_API_KEY;
}
if (!process.env.OPENAI_API_KEY && process.env.LLM_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.LLM_API_KEY;
}
if (!process.env.OPENAI_BASE_URL) {
  const codexBase = process.env.CODEX_PROXY_BASE_URL ?? process.env.LLM_PROXY_BASE_URL;
  if (codexBase) {
    const normalized = codexBase.replace(/\/+$/, '');
    process.env.OPENAI_BASE_URL = normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
  }
}

// Codex 0.140+ ignores OPENAI_BASE_URL and connects to api.openai.com via
// WebSocket for the Responses API — it reads proxy settings from
// CODEX_HOME/config.toml. AXIS creates an isolated (empty) CODEX_HOME per
// run so there is no config file. Prepend a generated `codex` wrapper to PATH
// so AXIS's `which codex` resolves to the wrapper; the wrapper writes the
// LiteLLM proxy config into CODEX_HOME then exec-s the real binary.
if (process.env.OPENAI_BASE_URL) {
  let realCodexPath: string | undefined;
  try {
    realCodexPath = execFileSync('which', ['codex'], { encoding: 'utf-8' }).trim();
  } catch {
    // codex not found in PATH — wrapper not needed
  }
  if (realCodexPath) {
    const tmpBin = mkdtempSync(join(tmpdir(), 'codex-proxy-'));
    const openaiBaseUrl = process.env.OPENAI_BASE_URL;
    writeFileSync(
      join(tmpBin, 'codex'),
      [
        '#!/usr/bin/env bash',
        '# Generated by npm run axis — writes LiteLLM proxy config into the',
        '# AXIS-isolated CODEX_HOME so codex reaches the proxy, not api.openai.com.',
        'set -euo pipefail',
        'if [ -n "${CODEX_HOME:-}" ]; then',
        '  mkdir -p "$CODEX_HOME"',
        '  if [ ! -f "$CODEX_HOME/config.toml" ]; then',
        '    cat > "$CODEX_HOME/config.toml" << TOML',
        'model_provider = "litellm"',
        '',
        '[model_providers.litellm]',
        'name = "Proxy"',
        `base_url = "${openaiBaseUrl}"`,
        'env_key = "OPENAI_API_KEY"',
        'supports_websockets = false',
        'TOML',
        '  fi',
        'fi',
        `exec "${realCodexPath}" "$@"`,
      ].join('\n') + '\n',
      { mode: 0o755 },
    );
    process.env.PATH = `${tmpBin}:${process.env.PATH ?? ''}`;
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

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error('[axis] LLM_API_KEY is not set — add it to .env or your shell before running');
  process.exit(1);
}

// runGraders() uses config.proxy.baseUrl (the LiteLLM proxy) for judge calls,
// not ANTHROPIC_BASE_URL. No model-ID remapping needed — the framework config's
// judge model (e.g. 'claude-opus-4-8') is what LiteLLM expects. Passing no
// judgeModel here lets runGraders() fall back to config.judge.model.
const { scoredOutput, graderResults } = await runAxis({
  configPath: join(APP_ROOT, 'axis.config.ts'),
  frameworkRoot: APP_ROOT,
  apiKey,
  ...(flags.debug === true ? { debug: true } : {}),
});

console.log(
  `[axis] Done — ${scoredOutput.summary.completed}/${scoredOutput.summary.total} completed` +
    (scoredOutput.summary.failed > 0 ? `, ${scoredOutput.summary.failed} failed` : ''),
);

// Write scores-axis.json and report-axis.html so results appear in npm run report.
const evalCategories = Object.fromEntries(discoverEvals('src/evals', APP_ROOT).map((cfg) => [cfg.id, cfg.category]));
const scores = buildAxisScores(scoredOutput, graderResults, evalCategories);
const scoresPath = typeof flags.output === 'string' ? flags.output : join(APP_ROOT, 'scores-axis.json');
writeFileSync(scoresPath, JSON.stringify(scores, null, 2), 'utf-8');
console.log(`[axis] Scores: ${scoresPath}`);

const reportPath = join(APP_ROOT, 'report-axis.html');
writeFileSync(reportPath, generateReportHtml(buildReportManifest(scoredOutput, graderResults)), 'utf-8');
console.log(`[axis] Report: ${reportPath}`);
