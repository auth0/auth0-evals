/**
 * Tests for the secret scrubber applied to anything sent to an LLM.
 *
 * Two properties matter and pull against each other: no credential value may
 * survive, and everything a diagnosis needs (the command, the resource ids, the
 * flag names) must survive. Both directions are asserted here.
 */

import { describe, it, expect } from 'vitest';
import { redactArgs, redactSecrets, REDACTION_MARKER } from '../src/utils/redact.js';

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

  it.each([
    ['a status code after `token =`', 'No token = 401. Valid token but wrong scope = 403.'],
    ['a token lifetime', '"expires_in": 86400'],
    ['a named lifetime setting', 'access_token_lifetime: 3600'],
  ])('keeps a numeric value that follows a credential word — %s', (_label, line) => {
    // Regression: a credential is never a bare number, but `token` and `secret` turn
    // up constantly in sentences that end in one. `No token = 401.` used to render as
    // `No token = [REDACTED SECRET] Valid…`, losing the status code and the sentence
    // break, and telling a reader a secret was exposed where none was.
    expect(redactSecrets(line)).toBe(line);
  });
});

describe('redactSecrets — value-shaped secrets with no name attached', () => {
  it('masks a PEM private key block whole', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\nabcd\n-----END RSA PRIVATE KEY-----';
    const out = redactSecrets(`key: ${pem}`);
    expect(out).not.toContain('MIIEowIBAAKCAQEA1234');
    // The BEGIN/END lines go too — leaving them behind would be a half-redaction.
    expect(out).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(out).toContain(REDACTION_MARKER);
  });

  it('masks a bare quoted secret in a grader detail', () => {
    // Real leak found in a shipped report: a `notContainsInSource` grader quotes the
    // needle it searched for, so the value arrives with no key beside it and is too
    // short for the length rule. The verdict has to stay readable.
    const out = redactSecrets("'barkbook_secret_def456uvw' NOT found in source files (good)");
    expect(out).not.toContain('barkbook_secret_def456uvw');
    expect(out).toContain('NOT found in source files (good)');
  });

  it.each([
    ['a meaningful short suffix', 'reset_password_2fa flow'],
    ['a version suffix', 'change_password_v2 template'],
    ['a settings name', 'reset_password_url setting'],
    ['a name with no value attached', 'AUTH0_SECRET is required by the SDK'],
  ])('keeps an identifier that merely embeds a credential word — %s', (_label, line) => {
    // The embedded-word rule needs a separator-flanked word, a 6+ character suffix,
    // and a digit before it fires — otherwise it would blank ordinary identifiers.
    expect(redactSecrets(line)).toBe(line);
  });

  it.each([
    // Bodies say what they are, so a secret scanner reading this file sees a fixture
    // rather than a candidate credential. The prefix is what the rule matches on.
    ['OpenAI', 'sk-notarealkey0123456789', 'notarealkey0123456789'],
    ['GitHub', 'ghp_notarealkey0123456789abcd', 'notarealkey0123456789abcd'],
    ['Slack', 'xoxb-0000000000-notarealkey', '0000000000-notarealkey'],
  ])('masks a vendor-prefixed %s key', (_label, key, body) => {
    // These sit below the 40-character floor of the opaque-token rule and carry no
    // credential word, so neither the name rules nor the length rule catches them.
    const out = redactSecrets(`export KEY=${key}`);
    expect(out).not.toContain(body);
    expect(out).toContain(REDACTION_MARKER);
  });
});

describe('redactArgs', () => {
  it('sweeps a .env write, which is how credentials actually reach a trace', () => {
    const out = redactArgs({
      path: '/tmp/auth0_eval_H6pqvZ/.env',
      content: [
        'VITE_AUTH0_DOMAIN=dev-barkbook.us.auth0.com',
        'VITE_AUTH0_CLIENT_ID=barkbook_client_abc123xyz',
        'AUTH0_CLIENT_SECRET=fixture_not_a_real_secret_9f8e7d6c5b4a',
      ].join('\n'),
    });

    const content = out['content'] as string;
    expect(content).not.toContain('fixture_not_a_real_secret_9f8e7d6c5b4a');
    // Public config and the client id survive — they are what makes a trace reviewable.
    expect(content).toContain('VITE_AUTH0_DOMAIN=dev-barkbook.us.auth0.com');
    expect(content).toContain('VITE_AUTH0_CLIENT_ID=barkbook_client_abc123xyz');
    expect(out['path']).toBe('/tmp/auth0_eval_H6pqvZ/.env');
  });

  it('recurses through nested objects and arrays', () => {
    const out = redactArgs({
      headers: { Authorization: 'Bearer abcdef0123456789abcdef' },
      lines: ['AUTH0_SECRET=fixture_not_a_real_secret_9f8e7d6c5b4a', 'PORT=3001'],
    });

    expect((out['headers'] as Record<string, unknown>)['Authorization']).toContain(REDACTION_MARKER);
    const lines = out['lines'] as string[];
    expect(lines[0]).not.toContain('fixture_not_a_real_secret_9f8e7d6c5b4a');
    expect(lines[1]).toBe('PORT=3001');
  });

  it.each([
    ['Authorization', 'Bearer abcdef0123456789abcdef'],
    ['client_secret', 'short1'],
    ['GH_TOKEN', 'notarealkey'],
  ])('masks a value whose own key names a credential — %s', (key, value) => {
    // In a structured record the credential's name is the object key, which the text
    // rules cannot see, and the value is often too short for the opaque-token floor.
    expect(redactArgs({ [key]: value })).toEqual({ [key]: REDACTION_MARKER });
  });

  it('keeps a value whose key merely contains a credential word', () => {
    // Same end-anchoring as the text rules: `…auth_method` is configuration, not a
    // credential, so a key match alone must not blank it.
    const args = { token_endpoint_auth_method: 'none', client_id: 'barkbook_client_abc123xyz' };
    expect(redactArgs(args)).toEqual(args);
  });

  it('preserves non-string primitives and their JSON types', () => {
    // Coercing these to strings would change the types consumers read back.
    expect(redactArgs({ count: 40, ok: true, missing: null, ratio: 0.5 })).toEqual({
      count: 40,
      ok: true,
      missing: null,
      ratio: 0.5,
    });
  });

  it('returns an empty record for empty args', () => {
    expect(redactArgs({})).toEqual({});
  });
});
