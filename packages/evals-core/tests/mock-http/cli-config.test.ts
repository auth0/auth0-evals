/**
 * Tests for the auth0 CLI config seeding.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeTmpDir } from '../tmp.js';
import { writeAuth0CliConfig } from '../../src/mock-http/cli-config.js';

const tmp = makeTmpDir('mockhttp_cfg_');

describe('writeAuth0CliConfig', () => {
  it('seeds a fake tenant pointing at 127.0.0.1:<port> with a far-future expiry', () => {
    const home = tmp();
    const path = writeAuth0CliConfig(home, { port: 8443 });
    expect(path).toBe(`${home}/.config/auth0/config.json`);

    const cfg = JSON.parse(readFileSync(path, 'utf-8'));
    expect(cfg.default_tenant).toBe('127.0.0.1:8443');
    const tenant = cfg.tenants['127.0.0.1:8443'];
    expect(tenant.domain).toBe('127.0.0.1:8443');
    expect(tenant.access_token).toBeTypeOf('string');
    // Far-future so the CLI never attempts a (impossible) token refresh.
    expect(new Date(tenant.expires_at).getFullYear()).toBeGreaterThan(2900);
  });

  it('honours a custom host', () => {
    const home = tmp();
    const path = writeAuth0CliConfig(home, { port: 9000, host: 'localhost' });
    const cfg = JSON.parse(readFileSync(path, 'utf-8'));
    expect(cfg.default_tenant).toBe('localhost:9000');
  });

  it('does not embed anything resembling a real credential', () => {
    const home = tmp();
    const path = writeAuth0CliConfig(home, { port: 8443 });
    const raw = readFileSync(path, 'utf-8');
    // The dummy token is explicitly marked as fake.
    expect(raw).toContain('mock-signature-not-a-real-token');
  });
});
