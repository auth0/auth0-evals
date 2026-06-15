import { describe, it, expect } from 'vitest';
import { resolveRuntimeConfig } from '../../../src/graders/runtime/resolve-config.js';

const fullEnv = {
  RUNTIME_AUTH0_DOMAIN: 'real.us.auth0.com',
  RUNTIME_TEST_USER_EMAIL: 'tester@example.com',
  RUNTIME_TEST_USER_PASSWORD: 'pw',
  RUNTIME_TEST_USER_NAME: 'Test User',
};

describe('resolveRuntimeConfig', () => {
  it('parses swap pairs and resolves env vars', () => {
    const res = resolveRuntimeConfig(
      { serveCommand: 'npm run dev', servePort: 5173, runtimeSwap: 'fake.auth0.com=$RUNTIME_AUTH0_DOMAIN' },
      fullEnv,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.swap).toEqual([{ from: 'fake.auth0.com', to: 'real.us.auth0.com' }]);
    expect(res.config.serveCommand).toBe('npm run dev');
    expect(res.config.servePort).toBe(5173);
    expect(res.config.testUser).toEqual({
      email: 'tester@example.com',
      password: 'pw',
      expectedName: 'Test User',
    });
  });

  it('carries installCommand through to the config', () => {
    const res = resolveRuntimeConfig(
      {
        serveCommand: 'npm run dev',
        servePort: 5173,
        runtimeSwap: 'fake.auth0.com=$RUNTIME_AUTH0_DOMAIN',
        installCommand: 'npm install',
      },
      fullEnv,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.installCommand).toBe('npm install');
  });

  it('reports missing test-user env vars', () => {
    const res = resolveRuntimeConfig(
      { serveCommand: 'npm run dev', servePort: 5173, runtimeSwap: 'fake.auth0.com=$RUNTIME_AUTH0_DOMAIN' },
      { RUNTIME_AUTH0_DOMAIN: 'real.us.auth0.com' },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missing).toContain('RUNTIME_TEST_USER_EMAIL');
    expect(res.missing).toContain('RUNTIME_TEST_USER_PASSWORD');
    expect(res.missing).toContain('RUNTIME_TEST_USER_NAME');
  });

  it('reports a swap env var that is not set', () => {
    const res = resolveRuntimeConfig(
      { serveCommand: 'npm run dev', servePort: 5173, runtimeSwap: 'fake.auth0.com=$RUNTIME_AUTH0_DOMAIN' },
      { RUNTIME_TEST_USER_EMAIL: 'a', RUNTIME_TEST_USER_PASSWORD: 'b', RUNTIME_TEST_USER_NAME: 'c' },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missing).toContain('RUNTIME_AUTH0_DOMAIN');
  });

  it('reports missing serve_command / serve_port', () => {
    const res = resolveRuntimeConfig({ runtimeSwap: 'fake=$RUNTIME_AUTH0_DOMAIN' }, fullEnv);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missing).toContain('serve_command');
    expect(res.missing).toContain('serve_port');
  });
});
