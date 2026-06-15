import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraderLevel } from '@a0/eval-graders';
import type { GraderDef } from '@a0/eval-graders';
import { makeRuntimeExecutor } from '../../../src/graders/executors/runtime.js';
import type { GraderContext } from '../../../src/graders/executors/types.js';

describe('runtime executor', () => {
  const created: string[] = [];
  afterEach(() => {
    for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function workspace(): string {
    const ws = mkdtempSync(join(tmpdir(), 'rt-exec-'));
    created.push(ws);
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src/App.jsx'), 'domain="fake.auth0.com"');
    return ws;
  }

  const def: GraderDef = {
    kind: 'runtime',
    name: 'logs in',
    scriptPath: './playwright.ts',
    level: GraderLevel.L4,
  };

  function baseContext(ws: string): GraderContext {
    return {
      workspace: ws,
      files: {},
      combinedText: '',
      combinedLower: '',
      runtime: {
        serveCommand: 'noop',
        servePort: 5173,
        swap: [{ from: 'fake.auth0.com', to: 'real.us.auth0.com' }],
        testUser: { email: 'a@b.com', password: 'pw', expectedName: 'Tester' },
        evalDir: ws,
      },
    };
  }

  it('fails when runtime context is absent', async () => {
    const ws = workspace();
    const exec = makeRuntimeExecutor({
      install: async () => {},
      launchBrowser: async () => {
        throw new Error('should not launch');
      },
      loadScript: async () => async () => ({ passed: true, detail: 'x' }),
      serve: async () => ({ stop: async () => {} }),
    });
    const ctx = baseContext(ws);
    delete ctx.runtime;
    const res = await exec.execute(def, ctx);
    expect(res.passed).toBe(false);
    expect(res.detail).toMatch(/runtime grading/i);
    expect(res.level).toBe(GraderLevel.L4);
  });

  it('names the missing prerequisites when runtimeMissing is provided', async () => {
    const ws = workspace();
    const exec = makeRuntimeExecutor({
      install: async () => {},
      launchBrowser: async () => {
        throw new Error('should not launch');
      },
      loadScript: async () => async () => ({ passed: true, detail: 'x' }),
      serve: async () => ({ stop: async () => {} }),
    });
    const ctx = baseContext(ws);
    delete ctx.runtime;
    ctx.runtimeMissing = ['RUNTIME_AUTH0_DOMAIN', 'RUNTIME_TEST_USER_PASSWORD'];
    const res = await exec.execute(def, ctx);
    expect(res.passed).toBe(false);
    expect(res.detail).toContain('RUNTIME_AUTH0_DOMAIN');
    expect(res.detail).toContain('RUNTIME_TEST_USER_PASSWORD');
  });

  it('passes when the injected script returns passed:true', async () => {
    const ws = workspace();
    let served = false;
    let stopped = false;
    let browserClosed = false;
    const exec = makeRuntimeExecutor({
      install: async () => {},
      serve: async () => {
        served = true;
        return {
          stop: async () => {
            stopped = true;
          },
        };
      },
      launchBrowser: async () => ({
        page: {} as never,
        close: async () => {
          browserClosed = true;
        },
      }),
      loadScript:
        async () =>
        async ({ baseURL, testUser }) => ({
          passed: true,
          detail: `ok ${baseURL} ${testUser.expectedName}`,
        }),
    });
    const res = await exec.execute(def, baseContext(ws));
    expect(res.passed).toBe(true);
    expect(res.detail).toContain('http://localhost:5173');
    expect(served).toBe(true);
    expect(stopped).toBe(true);
    expect(browserClosed).toBe(true);
  });

  it('fails (no throw) when the script throws, and still tears down', async () => {
    const ws = workspace();
    let stopped = false;
    const exec = makeRuntimeExecutor({
      install: async () => {},
      serve: async () => ({
        stop: async () => {
          stopped = true;
        },
      }),
      launchBrowser: async () => ({ page: {} as never, close: async () => {} }),
      loadScript: async () => async () => {
        throw new Error('login failed: selector not found');
      },
    });
    const res = await exec.execute(def, baseContext(ws));
    expect(res.passed).toBe(false);
    expect(res.detail).toContain('login failed');
    expect(stopped).toBe(true);
  });

  it('fails when serve never opens the port', async () => {
    const ws = workspace();
    const exec = makeRuntimeExecutor({
      install: async () => {},
      serve: async () => {
        throw new Error('serve_command never opened port 5173 within 1000ms');
      },
      launchBrowser: async () => {
        throw new Error('should not launch');
      },
      loadScript: async () => async () => ({ passed: true, detail: 'x' }),
    });
    const res = await exec.execute(def, baseContext(ws));
    expect(res.passed).toBe(false);
    expect(res.detail).toContain('never opened port');
  });

  it('runs install before serve when installCommand is set', async () => {
    const ws = workspace();
    const order: string[] = [];
    const exec = makeRuntimeExecutor({
      install: async (_cwd, cmd) => {
        order.push(`install:${cmd}`);
      },
      serve: async () => {
        order.push('serve');
        return { stop: async () => {} };
      },
      launchBrowser: async () => ({ page: {} as never, close: async () => {} }),
      loadScript: async () => async () => ({ passed: true, detail: 'ok' }),
    });
    const ctx = baseContext(ws);
    ctx.runtime!.installCommand = 'npm install';
    const res = await exec.execute(def, ctx);
    expect(res.passed).toBe(true);
    expect(order).toEqual(['install:npm install', 'serve']);
  });

  it('skips install when no installCommand is set', async () => {
    const ws = workspace();
    let installCalled = false;
    const exec = makeRuntimeExecutor({
      install: async () => {
        installCalled = true;
      },
      serve: async () => ({ stop: async () => {} }),
      launchBrowser: async () => ({ page: {} as never, close: async () => {} }),
      loadScript: async () => async () => ({ passed: true, detail: 'ok' }),
    });
    const res = await exec.execute(def, baseContext(ws)); // baseContext has no installCommand
    expect(res.passed).toBe(true);
    expect(installCalled).toBe(false);
  });
});
