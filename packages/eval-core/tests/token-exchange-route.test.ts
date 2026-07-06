/**
 * Tests for the Custom Token Exchange mock route (`mocks/routes/token-exchange.sh`).
 *
 * Exercises the actions + token-exchange-profiles surface end-to-end through the
 * dispatcher, including create → deploy → profile read-after-write.
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
  stateDir = mkdtempSync(join(tmpdir(), 'tex-route-test-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('token-exchange route — actions', () => {
  it('creates an action and returns a reusable id', () => {
    expect(run('api', 'POST', '/api/v2/actions', '--data', '{"name":"cte-validator"}')).toContain(
      '"id":"act_cte_validator"',
    );
  });

  it('reflects a created + deployed action on a later read', () => {
    run('api', 'POST', '/api/v2/actions', '--data', '{"name":"cte-validator"}');
    run('api', 'POST', '/api/v2/actions/act_cte_validator/deploy');
    const out = run('api', 'GET', '/api/v2/actions');
    expect(out).toContain('"id":"act_cte_validator"');
    expect(out).toContain('"deployed":true');
  });

  it('does not report an action as deployed until the deploy call runs', () => {
    run('api', 'POST', '/api/v2/actions', '--data', '{"name":"cte-validator"}');
    expect(run('api', 'GET', '/api/v2/actions')).toContain('"deployed":false');
  });

  it('returns an empty action list in fresh state', () => {
    expect(run('api', 'GET', '/api/v2/actions')).toBe('{"actions":[]}');
  });
});

describe('token-exchange route — profiles', () => {
  it('creates and reflects a token exchange profile', () => {
    run('api', 'POST', '/api/v2/token-exchange-profiles', '--data', '{"name":"legacy-migration"}');
    expect(run('api', 'GET', '/api/v2/token-exchange-profiles')).toContain('"id":"tep_legacy"');
  });

  it('returns an empty profile list in fresh state', () => {
    expect(run('api', 'GET', '/api/v2/token-exchange-profiles')).toBe('{"token_exchange_profiles":[]}');
  });
});
