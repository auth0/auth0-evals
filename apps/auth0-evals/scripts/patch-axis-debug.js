import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Locate @netlify/axis goal-achievement.js (installed at monorepo root node_modules)
let axisPath;
try {
  axisPath = require.resolve('@netlify/axis/dist/scoring/goal-achievement.js');
} catch {
  console.log('[patch-axis-debug] Could not resolve @netlify/axis, skipping');
  process.exit(0);
}

if (!existsSync(axisPath)) {
  console.log('[patch-axis-debug] File not found:', axisPath);
  process.exit(0);
}

const content = readFileSync(axisPath, 'utf8');
if (content.includes('[axis-judge-raw]')) {
  console.log('[patch-axis-debug] Already patched, skipping');
  process.exit(0);
}

const needle = 'const parsed = parseJsonFromText(responseText);';
if (!content.includes(needle)) {
  console.log('[patch-axis-debug] Needle not found in', axisPath);
  process.exit(0);
}

const patched = content.replace(
  needle,
  'process.stdout.write("[axis-judge-raw] " + JSON.stringify(responseText) + "\\n");\n    const parsed = parseJsonFromText(responseText);'
);

writeFileSync(axisPath, patched);
console.log('[patch-axis-debug] Patched', axisPath);
