/**
 * Tests for the mock Auth0 CLI stub (`mocks/auth0`).
 *
 * The stub must let the agent's tenant-config commands succeed
 * deterministically so the agent doesn't see an ambiguous response and thrash.
 * These tests exercise the path-normalization and success-echo behaviour that
 * covers both the bare-path form (`guardian/factors/otp`) the graders expect
 * and the full Management API URL form agents commonly emit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOCK = fileURLToPath(new URL('../../../mocks/auth0', import.meta.url));

let stateDir: string;

/** Run the mock CLI with an isolated per-test state dir; return trimmed stdout. */
function run(...args: string[]): string {
  return execFileSync(MOCK, args, {
    env: { ...process.env, EVAL_MOCK_STATE_DIR: stateDir },
    encoding: 'utf8',
  }).trim();
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'auth0-mock-test-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('mock auth0 — path normalization', () => {
  it('routes a bare guardian/factors path (grader form) to a success body', () => {
    expect(run('api', 'put', 'guardian/factors/otp', '--data', '{"enabled": true}')).toBe(
      '{"enabled":true}',
    );
  });

  it('routes a full Management API URL the same as the bare path', () => {
    // Regression: this form previously fell through to `{}`, an ambiguous
    // non-error that made agents doubt their auth and hunt for credentials.
    expect(
      run(
        'api',
        'PATCH',
        'https://dev-barkbook.us.auth0.com/api/v2/guardian/factors/otp',
        '--data',
        '{"enabled":true}',
      ),
    ).toBe('{"enabled":true}');
  });

  it('routes a leading-slash path', () => {
    expect(run('api', 'PUT', '/guardian/policies', '--data', '["all-applications"]')).toBe(
      '["all-applications"]',
    );
  });

  it('strips a leading /api/v2/ segment (host-less skill form)', () => {
    // The skill's CLI examples use `auth0 api POST /api/v2/...` with no host.
    // Regression: this form must route to the same place as the bare path.
    expect(run('api', 'PUT', '/api/v2/guardian/policies', '--data', '["all-applications"]')).toBe(
      '["all-applications"]',
    );
  });

  it('reflects a write made via the full-URL form on a later bare-path read', () => {
    run('api', 'PATCH', 'https://x.us.auth0.com/api/v2/guardian/factors/otp', '--data', '{"enabled":true}');
    expect(run('api', 'get', 'guardian/factors')).toContain('"name":"otp","enabled":true');
  });

  it('disables a factor via the full-URL form', () => {
    run('api', 'put', 'guardian/factors/otp', '--data', '{"enabled":true}');
    run('api', 'PATCH', 'https://x/api/v2/guardian/factors/otp', '--data', '{"enabled":false}');
    expect(run('api', 'get', 'guardian/factors')).toContain('"name":"otp","enabled":false');
  });
});

describe('mock auth0 — success echo for unmapped routes', () => {
  it('echoes a non-empty success for an unmapped write', () => {
    // A write that "succeeded" must not read as a no-op `{}`.
    expect(run('api', 'PATCH', 'tenants/settings', '--data', '{"flags":{"enable_mfa":true}}')).toBe(
      '{"ok":true}',
    );
  });

  it('still returns {} for an unmapped read', () => {
    expect(run('api', 'get', 'some/unknown/read')).toBe('{}');
  });
});
