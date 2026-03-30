import { readFileSync, readdirSync, appendFileSync } from 'node:fs';

const ALL_MODES = ['baseline', 'agent', 'agent+mcp', 'agent+skills'];

const files = readdirSync('.').filter(f => /^scores-.*\.json$/.test(f));
const results = files.flatMap(f => {
  try { return JSON.parse(readFileSync(f, 'utf-8')); }
  catch { return []; }
});

if (results.length === 0) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Eval Results\n\nNo results found.\n');
  process.exit(0);
}

const modeKey = r => {
  const tools = (r.tools || []).sort().join('+');
  return tools ? r.mode + '+' + tools : r.mode;
};

const byKey = {};
for (const r of results) {
  byKey[r.eval_id + '|' + modeKey(r) + '|' + r.model] = r;
}

const ranModes = ALL_MODES.filter(c => results.some(r => modeKey(r) === c));
const models = [...new Set(results.map(r => r.model))].sort();
const evals  = [...new Set(results.map(r => r.eval_id))].sort();

const cell = r => {
  if (!r) return '—';
  if (r.status === 'error' || r.status === 'failure') return '—';
  if (r.mode === 'baseline') {
    const pct = Math.round((r.grader_pass_rate || 0) * 100);
    const e = pct >= 80 ? '🟢' : pct >= 50 ? '🟡' : '🔴';
    return e + ' ' + pct + '%';
  }
  const g = r.overall_grade || '?';
  const s = Math.round(r.overall_score || 0);
  const p = Math.round((r.grader_pass_rate || 0) * 100);
  const e = g === 'A' ? '🟢' : g === 'B' ? '🟡' : '🔴';
  return e + ' ' + g + ' (' + s + ') ' + p + '%';
};

let md = '## Eval Results\n\n';

for (const model of models) {
  md += '### `' + model + '`\n\n';
  md += '| Eval | ' + ranModes.join(' | ') + ' |\n';
  md += '|---|' + ranModes.map(() => ':---:|').join('') + '\n';
  for (const e of evals) {
    const cells = ranModes.map(c => cell(byKey[e + '|' + c + '|' + model]));
    md += '| `' + e + '` | ' + cells.join(' | ') + ' |\n';
  }
  md += '\n';
}

md += '<details>\n<summary>Grader details</summary>\n\n';
for (const model of models) {
  if (models.length > 1) md += '#### `' + model + '`\n\n';
  for (const evalId of evals) {
    const graderIndex = new Map();
    for (const c of ranModes) {
      const r = byKey[evalId + '|' + c + '|' + model];
      if (r && Array.isArray(r.graders)) {
        for (const g of r.graders) {
          if (!graderIndex.has(g.name)) graderIndex.set(g.name, g);
        }
      }
    }
    if (graderIndex.size === 0) continue;
    md += '**`' + evalId + '`**\n\n';
    md += '| Grader | Level | ' + ranModes.join(' | ') + ' |\n';
    md += '|---|---|' + ranModes.map(() => ':---:|').join('') + '\n';
    for (const [name, meta] of graderIndex) {
      const cells = ranModes.map(c => {
        const r = byKey[evalId + '|' + c + '|' + model];
        if (!r || !Array.isArray(r.graders)) return '—';
        const gr = r.graders.find(x => x.name === name);
        if (!gr) return '—';
        return gr.passed ? '✅' : '❌';
      });
      const lvl = meta.level || '—';
      md += '| ' + name + ' | ' + lvl + ' | ' + cells.join(' | ') + ' |\n';
    }
    md += '\n';
  }
}
md += '</details>\n\n';

md += '## Cost & Performance\n\n';
md += '| Model | Jobs | Passed | Failed | Total Cost | Avg Wall Time |\n';
md += '|---|:---:|:---:|:---:|---:|---:|\n';
let grandTotal = 0;
for (const model of models) {
  const mr = results.filter(r => r.model === model);
  const passed = mr.filter(r => r.status !== 'error' && r.status !== 'failure').length;
  const cost   = mr.reduce((s, r) => s + Number(r.cost_usd  || 0), 0);
  const avgMs  = mr.reduce((s, r) => s + Number(r.wall_time || 0), 0) / (mr.length || 1);
  grandTotal  += cost;
  md += '| `' + model + '` | ' + mr.length + ' | ' + passed + ' | ' + (mr.length - passed) +
        ' | $' + cost.toFixed(4) + ' | ' + (avgMs / 1000).toFixed(1) + 's |\n';
}
md += '\n> **' + results.length + ' total job(s)** | grand total: $' + grandTotal.toFixed(4) + '\n';

appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
