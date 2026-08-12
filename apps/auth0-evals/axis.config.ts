/**
 * AXIS configuration for Auth0 evals.
 *
 * Dynamically builds AXIS scenarios from the auth0-evals PROMPT.md files so
 * the two systems stay in sync automatically — adding a new eval directory
 * automatically adds a new AXIS scenario with no extra maintenance.
 *
 * Run:
 *   npm run axis                                          # all evals, all agents
 *   npm run axis -- --eval react_quickstart               # single eval
 *   npm run axis -- --eval react_quickstart --agent codex # single eval + agent
 *   npm run axis -- --workers 4                           # limit parallelism
 *   npx axis run                                          # AXIS CLI only (no grader overlay)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverEvals } from '@a0/evals-core';
import type { AxisConfig } from '@netlify/axis';

// This file lives at apps/auth0-evals/axis.config.ts, so import.meta.url
// resolves to the app root — the same directory as eval.config.js and src/evals/.
const APP_ROOT = fileURLToPath(new URL('.', import.meta.url));

// Optional: AXIS_EVAL=react_quickstart npm run axis  (comma-separated for multiple)
const evalValues =
  process.env.AXIS_EVAL?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? [];
const evalFilter = evalValues.length > 0 ? new Set(evalValues) : null;

// Optional: AXIS_AGENT=claude-code npm run axis  (comma-separated for multiple)
const agentValues =
  process.env.AXIS_AGENT?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? [];
const agentFilter = agentValues.length > 0 ? new Set(agentValues) : null;

// Optional: AXIS_WORKERS=4 npm run axis  (parallel job limit)
const workersRaw = parseInt(process.env.AXIS_WORKERS ?? '', 10);
const workers = Number.isFinite(workersRaw) ? workersRaw : undefined;

// Optional: AXIS_MODEL=claude-sonnet-5 npm run axis  (override model for all agents)
const modelOverride = process.env.AXIS_MODEL?.trim() || undefined;

// Route Claude models through the Bedrock proxy when explicitly requested.
// Set CLAUDE_CODE_USE_BEDROCK_PROXY=1 to use full `global.anthropic.*` model IDs
// (required by the Bedrock proxy); otherwise short aliases are used.
const useBedrock = process.env.CLAUDE_CODE_USE_BEDROCK_PROXY === '1';
const CLAUDE_SONNET_5 = useBedrock ? 'global.anthropic.claude-sonnet-5' : 'claude-sonnet-5';
const CLAUDE_OPUS_5 = useBedrock ? 'global.anthropic.claude-opus-5' : 'claude-opus-5';

const evalConfigs = discoverEvals('src/evals', APP_ROOT).filter((cfg) => evalFilter === null || evalFilter.has(cfg.id));

/** Extract a single YAML frontmatter field value from raw PROMPT.md text. */
function fm(raw: string, field: string): string | undefined {
  return raw.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))?.[1]?.trim();
}

const scenarios = evalConfigs.map((cfg) => {
  const promptPath = join(APP_ROOT, cfg.path, 'PROMPT.md');
  const raw = readFileSync(promptPath, 'utf-8');

  // Extract the ## Task section — split on headings so multi-paragraph tasks
  // and blank lines are captured correctly. The multiline $ anchor in a
  // lookahead would stop at the first blank line, truncating the prompt.
  const taskSection = raw.split(/^(?=## )/m).find((s) => s.startsWith('## Task'));
  const prompt = taskSection?.replace(/^## Task[^\n]*\n/, '').trim() ?? '';

  const scaffold = fm(raw, 'scaffold');

  // Seed the agent workspace with the scaffold files.
  // sourceRoot for CopyAction is configDir (= APP_ROOT), so paths like
  // "src/evals/scaffolds/react/basic" resolve correctly.
  // Note: setup_command (e.g. npm install) is intentionally excluded here —
  // it's a pre-compile step run during grading, not a workspace setup step.
  // The agent handles its own dependency installation as part of the task.
  const setup: Array<{ action: 'copy'; match: string; destination: string }> = [];
  if (scaffold) {
    setup.push({ action: 'copy', match: `${scaffold}/**`, destination: '.' });
  }

  return {
    key: cfg.id,
    name: cfg.name,
    prompt,
    judge: `Did the agent correctly implement the ${cfg.name} Auth0 integration — using the right SDK packages, wiring up the provider correctly, and avoiding hallucinated or deprecated APIs? The task uses intentional test placeholders: the domain (e.g. dev-barkbook.us.auth0.com), client ID (e.g. barkbook_client_abc123xyz), and audience are all fake but structurally correct stand-ins. Treat them as valid values for evaluation purposes — do NOT penalize the agent for using them. Do NOT visit or validate any URLs from the task. Evaluate based on code structure, SDK usage, and configuration correctness alone.\n\nOUTPUT FORMAT: Your entire response must be only the JSON score object — no preamble, no reasoning, no code, no text before or after the JSON. The very first character of your response must be '{'.`,
    ...(setup.length > 0 ? { setup } : {}),
  };
});

// All agents supported by this config. AXIS_AGENT filters to a subset.
// Models match eval.config.js's known list so proxy aliases resolve correctly.
// Override the default for all agents with --model (or AXIS_MODEL env var).
const allAgents: AxisConfig['agents'] = [
  { agent: 'claude-code', model: CLAUDE_SONNET_5 },
  // codex 0.140+ removed --full-auto (the AXIS default) in favour of
  // --dangerously-bypass-approvals-and-sandbox for headless execution.
  // Proxy config is injected via the `codex` wrapper prepended to PATH by
  // apps/auth0-evals/src/axis/run.ts at startup.
  {
    agent: 'codex',
    model: 'gpt-5.6-luna',
    flags: { 'full-auto': false, 'dangerously-bypass-approvals-and-sandbox': true },
  },
  { agent: 'gemini', model: 'gemini-3.1-pro-preview' },
];

const filteredAgents =
  agentFilter === null ? allAgents : allAgents.filter((a) => typeof a !== 'string' && agentFilter.has(a.agent));

const agents = modelOverride
  ? filteredAgents.map((a) => (typeof a === 'string' ? a : { ...a, model: modelOverride }))
  : filteredAgents;

export default {
  scenarios,
  agents,
  // Use claude-code as the judge for all runs. For codex/gemini runs it's a
  // different adapter (preferred by resolveJudgeAgent); for claude-code runs
  // it falls back to itself — but claude-code reliably produces the JSON
  // {"score":0-10,"rationale":"..."} the AXIS scorer expects, whereas codex
  // (an agentic executor) does not.
  judging: {
    // The workspace is deleted before AXIS scoring runs (run() deletes it in
    // finally), so the judge spawns in an empty temp dir created by callJudge().
    // disallowedTools blocks:
    //   - WebFetch/WebSearch: prevents visiting the placeholder domain
    //     (dev-barkbook.us.auth0.com), which would 404 and score goal=0.
    //   - Bash/Read/Glob/Grep: prevents the judge from trying to read the empty
    //     workspace and concluding no files exist → score goal=0.
    // With all filesystem and web tools blocked the judge evaluates purely from
    // the transcript + final result text already in its prompt context.
    agents: [
      {
        agent: 'claude-code',
        model: CLAUDE_OPUS_5,
        flags: { disallowedTools: 'Bash,Read,Glob,Grep,WebFetch,WebSearch' },
      },
    ],
  },
  // AXIS passes through the default API key vars automatically. These extra
  // entries pass through the per-adapter proxy base URL env vars set by
  // apps/auth0-evals/src/axis/run.ts at startup — without them AXIS strips
  // the vars before the CLI process sees them.
  env: ['ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'GOOGLE_GEMINI_BASE_URL', 'NPM_CONFIG_REGISTRY'],
  settings: {
    ...(workers !== undefined ? { concurrency: workers } : {}),
    limits: {
      scenario: {
        // 30 minutes per scenario — matches auth0-evals runner task timeout.
        time_minutes: 30,
        tokens: 3_000_000,
      },
    },
  },
} satisfies AxisConfig;
