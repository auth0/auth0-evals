/**
 * Tests for the mock-CLI run-lifecycle glue.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTmpDir } from '../tmp.js';
import { startMockCliForEval } from '../../src/mock-http/lifecycle.js';
import type { MockCliHandle } from '../../src/mock-http/lifecycle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CERT_DIR = resolve(__dirname, '../../../../docker/mock-ca');

const tmp = makeTmpDir('mockhttp_life_');
let handle: MockCliHandle | undefined;
const prevAnalytics = process.env.AUTH0_CLI_ANALYTICS;

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  if (prevAnalytics === undefined) delete process.env.AUTH0_CLI_ANALYTICS;
  else process.env.AUTH0_CLI_ANALYTICS = prevAnalytics;
});

function writeRoutes(dir: string): void {
  writeFileSync(
    join(dir, 'tenant.routes.json'),
    JSON.stringify({ surface: 'tenant', routes: [{ match: 'GET tenants/settings', verb: 'static', body: { ok: 1 } }] }),
  );
}

describe('startMockCliForEval', () => {
  it('starts a server, seeds CLI config, disables telemetry, and stops cleanly', async () => {
    if (!existsSync(join(CERT_DIR, 'mockServer.pem'))) return; // certs required
    const routesDir = tmp();
    writeRoutes(routesDir);
    const home = tmp();

    handle = await startMockCliForEval({
      httpRoutesDir: routesDir,
      stateDir: tmp(),
      certDir: CERT_DIR,
      homeDir: home,
      port: 0,
    });

    expect(handle.server.port).toBeGreaterThan(0);
    expect(process.env.AUTH0_CLI_ANALYTICS).toBe('false');
    const cfg = JSON.parse(readFileSync(handle.cliConfigPath, 'utf-8'));
    expect(cfg.default_tenant).toBe(`127.0.0.1:${handle.server.port}`);
  });

  it('fails fast when a route references a missing fixture', async () => {
    const routesDir = tmp();
    mkdirSync(join(routesDir, 'fixtures', 'x'), { recursive: true });
    writeFileSync(
      join(routesDir, 'x.routes.json'),
      JSON.stringify({ surface: 'x', routes: [{ match: 'GET x', verb: 'static', body: 'missing.json' }] }),
    );
    await expect(
      startMockCliForEval({ httpRoutesDir: routesDir, stateDir: tmp(), certDir: CERT_DIR, homeDir: tmp(), port: 0 }),
    ).rejects.toThrow(/missing fixture/);
  });

  it('throws when the cert dir has no leaf cert', async () => {
    const routesDir = tmp();
    writeRoutes(routesDir);
    await expect(
      startMockCliForEval({ httpRoutesDir: routesDir, stateDir: tmp(), certDir: tmp(), homeDir: tmp(), port: 0 }),
    ).rejects.toThrow(/cert\/key not found/);
  });
});
