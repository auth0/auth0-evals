/**
 * Tests for the secret scrubber applied to anything sent to an LLM.
 *
 * Two properties matter and pull against each other: no credential value may
 * survive, and everything a diagnosis needs (the command, the resource ids, the
 * flag names) must survive. Both directions are asserted here.
 */

import { describe, it, expect } from 'vitest';
import { redactSecrets, REDACTION_MARKER } from '../src/utils/redact.js';

describe('redactSecrets — masks credential values', () => {
  it('masks a --client-secret flag value', () => {
    const out = redactSecrets('auth0 api post clients --client-secret fixture_not_a_real_secret_9f8e7d6c5b4a');
    expect(out).not.toContain('fixture_not_a_real_secret_9f8e7d6c5b4a');
    expect(out).toContain('--client-secret');
    expect(out).toContain(REDACTION_MARKER);
  });

  it('masks flag values written with =', () => {
    expect(redactSecrets('--api-key=abcd1234efgh')).toBe(`--api-key=${REDACTION_MARKER}`);
  });

  it('masks quoted flag values', () => {
    const out = redactSecrets('auth0 login --client-secret "quoted secret value"');
    expect(out).not.toContain('quoted secret value');
  });

  it('masks key: value and key=value pairs in output bodies', () => {
    const out = redactSecrets('{ "client_secret": "abc123xyz", "client_id": "aBcD1234" }');
    expect(out).not.toContain('abc123xyz');
    expect(out).toContain('client_id');
  });

  it('masks bearer and basic authorization headers', () => {
    expect(redactSecrets('curl -H "Authorization: Bearer abc.def.ghi"')).not.toContain('abc.def.ghi');
    expect(redactSecrets('Authorization: Basic dXNlcjpwYXNz')).not.toContain('dXNlcjpwYXNz');
    expect(redactSecrets('proxy-authorization: Bearer abc.def.ghi')).toContain(REDACTION_MARKER);
  });

  it('masks an authorization value in full when it holds an unusual character', () => {
    // Regression: the value match used to stop at characters like `%`, `!`, `#`, so a
    // token containing one leaked its suffix.
    expect(redactSecrets('Authorization: Bearer abc%secret!part#tail')).not.toContain('secret');
    expect(redactSecrets('Authorization: Bearer abc%secret!part#tail')).toContain(REDACTION_MARKER);
  });

  it('leaves the closing quote of a quoted authorization header intact', () => {
    const out = redactSecrets('curl -H "Authorization: Bearer abc%def"');
    expect(out).not.toContain('abc%def');
    expect(out).toBe(`curl -H "Authorization: Bearer ${REDACTION_MARKER}"`);
  });

  it('masks the password half of curl -u user:pass', () => {
    const out = redactSecrets('curl -u admin:hunter2 https://example.com');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('admin:');
  });

  it.each([
    ['attached -u', 'curl -uadmin:hunter2 https://example.com'],
    ['long --user with space', 'curl --user admin:hunter2 https://example.com'],
    ['long --user with =', 'curl --user=admin:hunter2 https://example.com'],
  ])('masks the password half of curl %s', (_label, cmd) => {
    const out = redactSecrets(cmd);
    expect(out).not.toContain('hunter2');
    expect(out).toContain('admin:');
  });

  it('masks a JWT anywhere it appears', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1g';
    expect(redactSecrets(`export TOKEN=${jwt}`)).not.toContain(jwt);
  });

  it('masks a long opaque token with no surrounding key', () => {
    const token = 'A'.repeat(48);
    expect(redactSecrets(`echo ${token}`)).not.toContain(token);
  });

  it('never nests markers when several patterns match the same text', () => {
    const out = redactSecrets('--client-secret fixture_not_a_real_secret_0123456789abcdefghijklmnopqrstuvwxyz01234567');
    expect(out.match(/REDACTED SECRET/g)).toHaveLength(1);
    expect(out).not.toContain('SECRET] SECRET]');
  });

  it('leaves text with no secrets untouched', () => {
    const clean = 'auth0 orgs create --name acme --display "Acme Inc"';
    expect(redactSecrets(clean)).toBe(clean);
  });
});

describe('redactSecrets — keeps what a diagnosis needs', () => {
  it('keeps client_ids readable', () => {
    // 32-char hex: identifying, not secret, and the analyst needs it to follow the run.
    const clientId = 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH';
    expect(redactSecrets(`--client-id ${clientId}`)).toContain(clientId);
  });

  it('keeps Auth0 resource ids readable', () => {
    const line = 'auth0 api post organizations/org_1nvs2Q8RCZGjMN7L/invitations';
    expect(redactSecrets(line)).toBe(line);
  });

  it('keeps a non-secret setting whose name merely contains a credential word', () => {
    // `token_endpoint_auth_method` ends in `method`, not in a credential word, so its
    // value is configuration and stays visible.
    const line = '"token_endpoint_auth_method": "none"';
    expect(redactSecrets(line)).toBe(line);
  });

  it('keeps `--auth-method Basic` intact', () => {
    // Regression: `Basic` here is Auth0's `token_endpoint_auth_method`, not an HTTP
    // auth scheme. Masking on the bare scheme swallowed the `--grants` flag after it,
    // and the security judge reads the marker as proof a secret was exposed — so a
    // false positive here costs a run its security score.
    const line = "auth0 apps create --name 'Smoke Automation' --type m2m --auth-method Basic --grants credentials";
    expect(redactSecrets(line)).toBe(line);
  });

  it('keeps a bare `Basic`/`Bearer` word with no authorization header around it', () => {
    const line = 'echo "Basic auth is enabled"';
    expect(redactSecrets(line)).toBe(line);
  });

  it('keeps the flag name when it masks the value', () => {
    expect(redactSecrets('--client-secret abcdef123456')).toContain('--client-secret');
  });

  it('handles empty input', () => {
    expect(redactSecrets('')).toBe('');
  });
});
