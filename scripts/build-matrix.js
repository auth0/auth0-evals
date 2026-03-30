import { appendFileSync } from 'node:fs';

const ALL_EVALS = [
  'react_quickstart',
  'nextjs_quickstart',
  'swift_quickstart',
  'express_quickstart',
];

const ALL_MODES = [
  { label: 'baseline',     mode: 'baseline', tools: ''       },
  { label: 'agent',        mode: 'agent',    tools: ''       },
  { label: 'agent-mcp',    mode: 'agent',    tools: 'mcp'    },
  { label: 'agent-skills', mode: 'agent',    tools: 'skills' },
];

const ALL_MODELS = [
  'gpt-5.2',
  'claude-4-6-sonnet',
  'claude-4-6-opus',
  'gemini-3-pro-preview',
];

const evalsIn  = process.env.EVALS_INPUT;
const modesIn  = process.env.MODES_INPUT;
const modelsIn = process.env.MODELS_INPUT;

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

const total = evals.length * modes.length * models.length;
const matrix = JSON.stringify({ eval: evals, mode: modes, model: models });
console.log('Matrix (' + total + ' jobs):', matrix);
appendFileSync(process.env.GITHUB_OUTPUT, 'matrix=' + matrix + '\n');
