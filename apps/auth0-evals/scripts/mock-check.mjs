#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mock } from '@a0/eval-core';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const stateDir = join(cwd, '.mock-state');
const MOCKS = join(cwd, 'mocks');

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: mock:check <surface> [METHOD path ...]');
  console.error('');
  console.error('Examples:');
  console.error('  mock:check guardian');
  console.error('  mock:check guardian GET /api/v2/guardian/factors');
  process.exit(1);
}

const surface = args[0];
const probes = [];
for (let i = 1; i < args.length; i += 2) {
  if (i + 1 < args.length) {
    probes.push({ method: args[i], path: args[i + 1] });
  }
}

try {
  const result = await mock.runMockCli({
    binName: surface,
    stripPrefixes: [],
    manifestDirs: [MOCKS],
    stateDir,
  }, probes);

  for (const r of result) {
    console.log(`${r.method} ${r.path}`);
    if (r.body !== undefined) {
      console.log(JSON.stringify(r.body, null, 2));
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
