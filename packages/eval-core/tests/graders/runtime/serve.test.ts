import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../../src/graders/runtime/serve.js';

describe('startServer', () => {
  const dirs: string[] = [];
  let handle: { stop: () => Promise<void> } | undefined;

  afterEach(async () => {
    if (handle) await handle.stop();
    handle = undefined;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'serve-test-'));
    dirs.push(d);
    return d;
  }

  it('resolves once the port is accepting connections', async () => {
    const dir = tmp();
    const port = 47213;
    // A tiny node http server bound to the port.
    const cmd = `node -e "require('http').createServer((_, r) => r.end('ok')).listen(${port})"`;
    handle = await startServer(dir, cmd, port, { timeoutMs: 10_000, pollMs: 100 });
    expect(handle).toBeDefined();
  });

  it('rejects when the port never opens within the timeout', async () => {
    const dir = tmp();
    const port = 47214;
    // A command that exits immediately and never binds the port.
    const cmd = `node -e "process.exit(0)"`;
    await expect(startServer(dir, cmd, port, { timeoutMs: 1500, pollMs: 100 })).rejects.toThrow(/never opened port/);
  });

  it('resolves for an IPv6-only server (e.g. Vite binds [::1])', async () => {
    const dir = tmp();
    const port = 47215;
    // Bind the loopback on IPv6 only, mirroring Vite 5+ which listens on [::1].
    const cmd = `node -e "require('http').createServer((_, r) => r.end('ok')).listen(${port}, '::1')"`;
    handle = await startServer(dir, cmd, port, { timeoutMs: 10_000, pollMs: 100 });
    expect(handle).toBeDefined();
  });
});
