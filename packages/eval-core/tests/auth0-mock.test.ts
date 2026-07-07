/**
 * Tests for the mock Auth0 CLI dispatcher (`mocks/auth0`).
 *
 * These exercise only the SHARED mechanism — path normalization, route-file
 * discovery, and the fallthrough — using a throwaway fixture route file, so the
 * dispatcher test stays independent of any feature's routes (guardian,
 * token-exchange, …), which live in their own PRs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOCK = fileURLToPath(new URL('../../../apps/auth0-evals/mocks/auth0', import.meta.url));
const ROUTES_DIR = fileURLToPath(new URL('../../../apps/auth0-evals/mocks/routes/', import.meta.url));

let stateDir: string;
let fixtureRoute: string;

/** Run the mock CLI with an isolated per-test state dir; return trimmed stdout. */
function run(...args: string[]): string {
  return execFileSync(MOCK, args, {
    env: { ...process.env, EVAL_MOCK_STATE_DIR: stateDir },
    encoding: 'utf8',
  }).trim();
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'auth0-mock-test-'));
  // Drop a throwaway route file exercising a stateful read-after-write surface.
  // Named with a leading `zz-` so it never collides with real feature routes.
  fixtureRoute = join(ROUTES_DIR, 'zz-mock-test-fixture.sh');
  writeFileSync(
    fixtureRoute,
    `case "$ROUTE" in
  "get widgets") if has_state test_widget; then emit '[{"id":"w1"}]'; else emit '[]'; fi ;;
  "post widgets") record_state test_widget; emit '{"id":"w1"}' ;;
esac
`,
  );
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(fixtureRoute, { force: true });
});

describe('mock auth0 — path normalization', () => {
  it('routes a bare path to its route file', () => {
    expect(run('api', 'POST', 'widgets', '--data', '{}')).toBe('{"id":"w1"}');
  });

  it('routes a full Management API URL the same as the bare path', () => {
    // Regression: this form previously fell through to `{}`, an ambiguous
    // non-error that made agents doubt their auth and hunt for credentials.
    expect(run('api', 'POST', 'https://dev-barkbook.us.auth0.com/api/v2/widgets', '--data', '{}')).toBe(
      '{"id":"w1"}',
    );
  });

  it('routes a leading-slash path', () => {
    expect(run('api', 'POST', '/widgets', '--data', '{}')).toBe('{"id":"w1"}');
  });

  it('strips a leading /api/v2/ segment (host-less skill form)', () => {
    // The skill's CLI examples use `auth0 api POST /api/v2/...` with no host.
    expect(run('api', 'POST', '/api/v2/widgets', '--data', '{}')).toBe('{"id":"w1"}');
  });
});

describe('mock auth0 — stateful read-after-write via route helpers', () => {
  it('reflects a write on a later read', () => {
    expect(run('api', 'GET', 'widgets')).toBe('[]');
    run('api', 'POST', 'widgets', '--data', '{}');
    expect(run('api', 'GET', 'widgets')).toBe('[{"id":"w1"}]');
  });

  it('reflects a write made via the full-URL form on a later bare-path read', () => {
    run('api', 'POST', 'https://x.us.auth0.com/api/v2/widgets', '--data', '{}');
    expect(run('api', 'GET', 'widgets')).toBe('[{"id":"w1"}]');
  });
});

describe('mock auth0 — fallthrough for unrouted requests', () => {
  it('echoes a non-empty success for an unmapped write', () => {
    // A write that "succeeded" must not read as a no-op `{}`.
    expect(run('api', 'PATCH', 'tenants/settings', '--data', '{"flags":{}}')).toBe('{"ok":true}');
  });

  it('returns {} for an unmapped read', () => {
    expect(run('api', 'get', 'some/unknown/read')).toBe('{}');
  });
});

describe('mock auth0 — non-api subcommands', () => {
  it('treats login as a no-op success', () => {
    expect(run('login', '--domain', 'x.us.auth0.com')).toContain('logged in');
  });
});

describe('mock auth0 — per-eval routes via EVAL_MOCK_ROUTES_DIRS', () => {
  let perEvalDir: string;

  beforeEach(() => {
    // A route dir simulating one shipped next to an eval's PROMPT.md.
    perEvalDir = mkdtempSync(join(tmpdir(), 'per-eval-routes-'));
    writeFileSync(
      join(perEvalDir, 'gadgets.sh'),
      `case "$ROUTE" in
  "get gadgets") emit '[{"id":"g1"}]' ;;
esac
`,
    );
  });

  afterEach(() => rmSync(perEvalDir, { recursive: true, force: true }));

  it('sources a route from a dir named on EVAL_MOCK_ROUTES_DIRS', () => {
    const out = execFileSync(MOCK, ['api', 'get', 'gadgets'], {
      env: { ...process.env, EVAL_MOCK_STATE_DIR: stateDir, EVAL_MOCK_ROUTES_DIRS: perEvalDir },
      encoding: 'utf8',
    }).trim();
    expect(out).toBe('[{"id":"g1"}]');
  });

  it('falls back to {} for that route when the dir is not provided', () => {
    // Without EVAL_MOCK_ROUTES_DIRS, the per-eval route is not loaded.
    expect(run('api', 'get', 'gadgets')).toBe('{}');
  });
});
