import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRuntimeWorkspace } from '../../../src/graders/runtime/prepare-workspace.js';

describe('prepareRuntimeWorkspace', () => {
  const created: string[] = [];

  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeWorkspace(): string {
    const ws = mkdtempSync(join(tmpdir(), 'rt-ws-'));
    created.push(ws);
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src/App.jsx'), 'domain="fake.auth0.com" clientId="fake_client"');
    return ws;
  }

  it('copies the workspace and swaps fake values for real ones', () => {
    const ws = makeWorkspace();
    const { copyPath, cleanup } = prepareRuntimeWorkspace(ws, [
      { from: 'fake.auth0.com', to: 'real.us.auth0.com' },
      { from: 'fake_client', to: 'REAL_CLIENT' },
    ]);
    created.push(copyPath);

    const copied = readFileSync(join(copyPath, 'src/App.jsx'), 'utf-8');
    expect(copied).toContain('real.us.auth0.com');
    expect(copied).toContain('REAL_CLIENT');
    expect(copied).not.toContain('fake.auth0.com');

    cleanup();
    expect(existsSync(copyPath)).toBe(false);
  });

  it('leaves the original workspace untouched', () => {
    const ws = makeWorkspace();
    const { copyPath, cleanup } = prepareRuntimeWorkspace(ws, [{ from: 'fake.auth0.com', to: 'real.us.auth0.com' }]);
    created.push(copyPath);

    const original = readFileSync(join(ws, 'src/App.jsx'), 'utf-8');
    expect(original).toContain('fake.auth0.com');
    cleanup();
  });

  it('skips node_modules when copying', () => {
    const ws = makeWorkspace();
    mkdirSync(join(ws, 'node_modules/foo'), { recursive: true });
    writeFileSync(join(ws, 'node_modules/foo/index.js'), 'noise');
    const { copyPath, cleanup } = prepareRuntimeWorkspace(ws, []);
    created.push(copyPath);
    expect(existsSync(join(copyPath, 'node_modules'))).toBe(false);
    cleanup();
  });
});
