/**
 * AXIS configuration for Auth0 evals.
 *
 * Dynamically builds AXIS scenarios from the auth0-evals PROMPT.md files so
 * the two systems stay in sync automatically — adding a new eval directory
 * automatically adds a new AXIS scenario with no extra maintenance.
 *
 * Run:
 *   npm run axis          # programmatic runner (includes auth0-evals graders)
 *   npx axis run          # AXIS CLI only (no grader overlay)
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
const evalFilter = process.env.AXIS_EVAL ? new Set(process.env.AXIS_EVAL.split(',').map((s) => s.trim())) : null;

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
    judge: `Did the agent correctly implement the ${cfg.name} Auth0 integration — using the right SDK packages, wiring up the provider correctly, and avoiding hallucinated or deprecated APIs? The task uses placeholder credentials and a non-existent domain (e.g. dev-barkbook.us.auth0.com). Do NOT visit or validate any URLs from the task — they are intentionally fake. Evaluate based on code structure, SDK usage, and configuration correctness alone.`,
    ...(setup.length > 0 ? { setup } : {}),
  };
});

export default {
  scenarios,
  // The AXIS claude-code adapter uses the claude CLI with ANTHROPIC_BASE_URL
  // pointing to the proxy's /anthropic endpoint, which requires full Bedrock IDs.
  agents: [{ agent: 'claude-code', model: 'global.anthropic.claude-opus-4-8' }],
  settings: {
    limits: {
      scenario: {
        // 30 minutes per scenario — matches auth0-evals runner task timeout.
        time_minutes: 30,
        tokens: 3_000_000,
      },
    },
  },
} satisfies AxisConfig;
