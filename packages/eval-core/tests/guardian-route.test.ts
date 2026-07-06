/**
 * Tests for the Guardian mock route (`mocks/routes/guardian.sh`).
 *
 * Exercises the guardian API surface end-to-end through the dispatcher:
 * enabling factors, setting the enforcement policy, and read-after-write.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOCK = fileURLToPath(new URL('../../../apps/auth0-evals/mocks/auth0', import.meta.url));

let stateDir: string;

function run(...args: string[]): string {
  return execFileSync(MOCK, args, {
    env: { ...process.env, EVAL_MOCK_STATE_DIR: stateDir },
    encoding: 'utf8',
  }).trim();
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'guardian-route-test-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('guardian route — factors', () => {
  it('lists all factors disabled in fresh state', () => {
    const out = run('api', 'get', 'guardian/factors');
    expect(out).toContain('"name":"otp","enabled":false');
    expect(out).toContain('"name":"sms","enabled":false');
  });

  it('reflects an enabled factor on a later read (read-after-write)', () => {
    run('api', 'put', 'guardian/factors/otp', '--data', '{"enabled": true}');
    expect(run('api', 'get', 'guardian/factors')).toContain('"name":"otp","enabled":true');
  });

  it('routes the full Management API URL form', () => {
    run('api', 'PATCH', 'https://dev-barkbook.us.auth0.com/api/v2/guardian/factors/otp', '--data', '{"enabled":true}');
    expect(run('api', 'get', 'guardian/factors')).toContain('"name":"otp","enabled":true');
  });

  it('disables a factor when the payload sets enabled:false', () => {
    run('api', 'put', 'guardian/factors/otp', '--data', '{"enabled":true}');
    run('api', 'patch', 'guardian/factors/otp', '--data', '{"enabled":false}');
    expect(run('api', 'get', 'guardian/factors')).toContain('"name":"otp","enabled":false');
  });
});

describe('guardian route — policies', () => {
  it('returns an empty policy list in fresh state', () => {
    expect(run('api', 'get', 'guardian/policies')).toBe('[]');
  });

  it('reflects the enforcement policy once set', () => {
    run('api', 'put', 'guardian/policies', '--data', '["all-applications"]');
    expect(run('api', 'get', 'guardian/policies')).toBe('["all-applications"]');
  });
});
