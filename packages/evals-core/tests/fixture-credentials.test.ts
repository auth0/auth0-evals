/**
 * Tests for src/fixture/credentials.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { readVerifierCredentials, writeVerifierCredentialsFile, VERIFIER_ENV } from '../src/fixture/credentials.js';
import { makeTmpDir } from './tmp.js';

describe('readVerifierCredentials', () => {
  const tmp = makeTmpDir('verifier_creds_');

  function writeCredsFile(content: string): string {
    const path = join(tmp(), 'creds.json');
    writeFileSync(path, content);
    return path;
  }

  it('returns null when nothing is set', () => {
    expect(readVerifierCredentials({})).toBeNull();
  });

  it('ignores empty-string env vars', () => {
    expect(
      readVerifierCredentials({
        [VERIFIER_ENV.domain]: '',
        [VERIFIER_ENV.clientId]: '',
        [VERIFIER_ENV.clientSecret]: '',
      }),
    ).toBeNull();
  });

  it('returns credentials when all three env vars are set', () => {
    expect(
      readVerifierCredentials({
        [VERIFIER_ENV.domain]: 'acme.auth0.com',
        [VERIFIER_ENV.clientId]: 'the-id',
        [VERIFIER_ENV.clientSecret]: 'the-secret',
      }),
    ).toEqual({ domain: 'acme.auth0.com', clientId: 'the-id', clientSecret: 'the-secret' });
  });

  it('throws listing missing names, without leaking provided values', () => {
    let message = '';
    try {
      readVerifierCredentials({
        [VERIFIER_ENV.domain]: 'acme.auth0.com',
        [VERIFIER_ENV.clientSecret]: 'the-secret',
      });
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain(VERIFIER_ENV.clientId);
    expect(message).not.toContain(VERIFIER_ENV.domain);
    expect(message).not.toContain(VERIFIER_ENV.clientSecret);
    expect(message).not.toContain('acme.auth0.com');
    expect(message).not.toContain('the-secret');
  });

  it('throws when only one env var is set', () => {
    expect(() => readVerifierCredentials({ [VERIFIER_ENV.clientSecret]: 'the-secret' })).toThrow(
      new RegExp(`${VERIFIER_ENV.domain}.*${VERIFIER_ENV.clientId}`),
    );
  });

  it('parses the credentials file and deletes it afterwards', () => {
    const path = writeCredsFile(
      JSON.stringify({ domain: 'file.auth0.com', client_id: 'file-id', client_secret: 'file-secret' }),
    );

    const creds = readVerifierCredentials({ [VERIFIER_ENV.file]: path });

    expect(creds).toEqual({ domain: 'file.auth0.com', clientId: 'file-id', clientSecret: 'file-secret' });
    expect(existsSync(path)).toBe(false);
  });

  it('throws naming the missing field and still deletes the file', () => {
    const path = writeCredsFile(JSON.stringify({ domain: 'file.auth0.com', client_id: 'file-id' }));

    let message = '';
    try {
      readVerifierCredentials({ [VERIFIER_ENV.file]: path });
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain('client_secret');
    expect(message).not.toContain('file-id');
    expect(message).not.toContain('file.auth0.com');
    expect(existsSync(path)).toBe(false);
  });

  it('throws on invalid JSON and still deletes the file', () => {
    const path = writeCredsFile('{ not json with file-secret');

    let message = '';
    try {
      readVerifierCredentials({ [VERIFIER_ENV.file]: path });
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain(VERIFIER_ENV.file);
    expect(message).not.toContain('file-secret');
    expect(existsSync(path)).toBe(false);
  });

  it('throws when the file does not exist', () => {
    const path = join(tmp(), 'missing.json');
    expect(() => readVerifierCredentials({ [VERIFIER_ENV.file]: path })).toThrow();
  });

  it('prefers the file over env vars', () => {
    const path = writeCredsFile(
      JSON.stringify({ domain: 'file.auth0.com', client_id: 'file-id', client_secret: 'file-secret' }),
    );

    const creds = readVerifierCredentials({
      [VERIFIER_ENV.file]: path,
      [VERIFIER_ENV.domain]: 'env.auth0.com',
      [VERIFIER_ENV.clientId]: 'env-id',
      [VERIFIER_ENV.clientSecret]: 'env-secret',
    });

    expect(creds?.domain).toBe('file.auth0.com');
    expect(existsSync(path)).toBe(false);
  });
});

describe('writeVerifierCredentialsFile', () => {
  const creds = { domain: 'w.auth0.com', clientId: 'w-id', clientSecret: 'w-secret' };
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('round-trips through readVerifierCredentials and the read deletes the file', () => {
    const path = writeVerifierCredentialsFile(creds);
    dirs.push(dirname(path));
    expect(existsSync(path)).toBe(true);

    expect(readVerifierCredentials({ [VERIFIER_ENV.file]: path })).toEqual(creds);
    expect(existsSync(path)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('creates the file with mode 0600', () => {
    const path = writeVerifierCredentialsFile(creds);
    dirs.push(dirname(path));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
