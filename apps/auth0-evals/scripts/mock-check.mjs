#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mock } from '@a0/eval-core';

const cwd = fileURLToPath(new URL('..', import.meta.url));
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

let stateDir = null;
try {
  stateDir = mkdtempSync(join(tmpdir(), 'auth0-mock-'));

  // Load handlers if present
  let handlers = {};
  const handlersFile = join(MOCKS, 'handlers.js');
  if (existsSync(handlersFile)) {
    handlers = (await import(handlersFile)).default ?? {};
  }

  const config = {
    binName: 'auth0',
    stripPrefixes: ['api/v2/'],
    manifestDirs: [MOCKS],
    stateDir,
  };

  for (const { method, path } of probes) {
    const argv = ['api', method.toLowerCase(), path];
    const result = await mock.runMockCli(argv, config, handlers);
    const body = JSON.parse(result);
    console.log(`${method} ${path} -> ${JSON.stringify(body)}`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
} finally {
  if (stateDir && existsSync(stateDir)) {
    rmSync(stateDir, { recursive: true, force: true });
  }
}
