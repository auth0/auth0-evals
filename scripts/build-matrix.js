import { resolve } from 'node:path';
import * as core from '@actions/core';
import { discoverEvals } from '@a0/eval-core';

const frameworkRoot = resolve('apps/auth0-evals');
const ALL_EVALS = discoverEvals('src/evals', frameworkRoot).map(e => e.id);

const ALL_MODES = [
  { label: 'baseline',         mode: 'baseline', tools: ''            },
  { label: 'agent-skills',     mode: 'agent',    tools: 'skills'      },
  { label: 'agent-mcp-skills', mode: 'agent',    tools: 'mcp,skills'  },
];

const ALL_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview',
];

const evalsIn     = process.env.EVALS_INPUT;
const modesIn     = process.env.MODES_INPUT;
const modelsIn    = process.env.MODELS_INPUT;
const agentTypeIn = process.env.AGENT_TYPE_INPUT ?? 'auto';

const evals = evalsIn === 'all'
  ? ALL_EVALS
  : evalsIn.split(',').map(s => s.trim()).filter(s => ALL_EVALS.includes(s));

if (evals.length === 0) throw new Error('No valid evals in: ' + evalsIn);

let modes;
if (modesIn === 'all') {
  modes = ALL_MODES;
} else if (modesIn === 'baseline') {
  modes = ALL_MODES.filter(m => m.mode === 'baseline');
} else if (modesIn === 'agent') {
  modes = ALL_MODES.filter(m => m.mode === 'agent');
} else {
  const wanted = new Set(modesIn.split(',').map(s => s.trim()));
  modes = ALL_MODES.filter(m => wanted.has(m.label));
}

if (modes.length === 0) throw new Error('No valid modes in: ' + modesIn);

const models = modelsIn === 'all'
  ? ALL_MODELS
  : modelsIn.split(',').map(s => s.trim()).filter(Boolean);

if (models.length === 0) throw new Error('No valid models in: ' + modelsIn);

/** Mirrors the auto-resolution logic in src/run.ts */
function resolveAgentType(model, override) {
  if (override && override !== 'auto') return override;
  if (model.startsWith('claude-'))  return 'claude-code';
  if (model.startsWith('gemini-'))  return 'gemini-cli';
  if (model.startsWith('gpt-'))     return 'copilot';
  return 'copilot';
}

// Build an explicit include list so each job has a pre-resolved agent_type.
const include = [];
for (const evalId of evals) {
  for (const mode of modes) {
    for (const model of models) {
      include.push({
        eval: evalId,
        mode,
        model,
        agent_type: resolveAgentType(model, agentTypeIn),
      });
    }
  }
}

const matrix = JSON.stringify({ include });
console.log('Matrix (' + include.length + ' jobs):', matrix);
core.setOutput('matrix', matrix);
