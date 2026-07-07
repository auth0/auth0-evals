import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMockCli } from '../../src/mock/engine.js';
import type { EngineConfig } from '../../src/mock/types.js';

let mockDir: string, stateDir: string;
beforeEach(() => {
  mockDir = mkdtempSync(join(tmpdir(), 'engine-mock-'));
  stateDir = mkdtempSync(join(tmpdir(), 'engine-state-'));
  mkdirSync(join(mockDir, 'fixtures', 'x'), { recursive: true });
  writeFileSync(join(mockDir, 'x.routes.json'), JSON.stringify({
    surface: 'x',
    routes: [
      { match: 'POST widgets', verb: 'create', state: 'x.widget', body: { id: 'w1' } },
      { match: 'GET widgets', verb: 'reflect', state: 'x.widget', present: { items: [{ id: 'w1' }] }, absent: { items: [] } },
      { match: 'GET ping', verb: 'static', body: { pong: true } },
      { match: 'GET computed', verb: 'handler', handler: 'computed' },
    ],
  }));
});
afterEach(() => {
  rmSync(mockDir, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

function cfg(): EngineConfig {
  return { binName: 'auth0', stripPrefixes: ['api/v2/'], manifestDirs: [mockDir], stateDir };
}

describe('runMockCli', () => {
  it('static verb returns its body', async () => {
    expect(await runMockCli(['api', 'get', 'ping'], cfg())).toBe('{"pong":true}');
  });

  it('create then reflect (read-after-write), full-URL form normalizes', async () => {
    await runMockCli(['api', 'POST', 'https://t/api/v2/widgets', '--data', '{}'], cfg());
    expect(await runMockCli(['api', 'get', 'widgets'], cfg())).toBe('{"items":[{"id":"w1"}]}');
  });

  it('reflect returns absent body before any write', async () => {
    expect(await runMockCli(['api', 'get', 'widgets'], cfg())).toBe('{"items":[]}');
  });

  it('handler verb calls the named handler', async () => {
    const out = await runMockCli(['api', 'get', 'computed'], cfg(), {
      computed: (ctx) => ({ seen: ctx.state.has('x.widget') }),
    });
    expect(out).toBe('{"seen":false}');
  });

  it('unmatched write falls through to {"ok":true}', async () => {
    expect(await runMockCli(['api', 'patch', 'unknown'], cfg())).toBe('{"ok":true}');
  });

  it('unmatched read falls through to {}', async () => {
    expect(await runMockCli(['api', 'get', 'unknown'], cfg())).toBe('{}');
  });

  it('non-api subcommand returns a no-op success line', async () => {
    expect(await runMockCli(['login', '--domain', 'x'], cfg())).toContain('mock');
  });
});
