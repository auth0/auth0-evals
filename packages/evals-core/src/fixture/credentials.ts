import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface VerifierCredentials {
  domain: string;
  clientId: string;
  clientSecret: string;
}

/** Environment variables that carry the verifier credentials. */
export const VERIFIER_ENV = {
  domain: 'AUTH0_VERIFIER_DOMAIN',
  clientId: 'AUTH0_VERIFIER_CLIENT_ID',
  clientSecret: 'AUTH0_VERIFIER_CLIENT_SECRET',
  file: 'AUTH0_VERIFIER_CREDENTIALS_FILE',
} as const;

const FILE_FIELDS = ['domain', 'client_id', 'client_secret'] as const;

/**
 * Reads the verifier tenant credentials used by eval fixtures, or returns null
 * when none are configured.
 *
 * A credentials file takes precedence over the individual env vars. The file is
 * deleted as soon as it is read: on Linux a same-user agent process can read the
 * parent's `/proc/<pid>/environ`, so CI should pass a file path rather than the
 * secret itself. Error messages name missing fields but never include values.
 */
export function readVerifierCredentials(env: NodeJS.ProcessEnv = process.env): VerifierCredentials | null {
  const filePath = env[VERIFIER_ENV.file];
  if (filePath) {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } finally {
      rmSync(filePath, { force: true });
    }

    let parsed: Record<string, unknown>;
    try {
      const json: unknown = JSON.parse(raw);
      if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('not an object');
      parsed = json as Record<string, unknown>;
    } catch {
      throw new Error(`${VERIFIER_ENV.file} must point to a JSON file with ${FILE_FIELDS.join(', ')}`);
    }

    const missing = FILE_FIELDS.filter((field) => typeof parsed[field] !== 'string' || parsed[field] === '');
    if (missing.length > 0) {
      throw new Error(`Verifier credentials file is missing field(s): ${missing.join(', ')}`);
    }
    return {
      domain: parsed.domain as string,
      clientId: parsed.client_id as string,
      clientSecret: parsed.client_secret as string,
    };
  }

  const names = [VERIFIER_ENV.domain, VERIFIER_ENV.clientId, VERIFIER_ENV.clientSecret];
  const present = names.filter((name) => env[name]);
  if (present.length === 0) return null;

  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Incomplete verifier credentials, missing env var(s): ${missing.join(', ')}`);
  }
  return {
    domain: env[VERIFIER_ENV.domain]!,
    clientId: env[VERIFIER_ENV.clientId]!,
    clientSecret: env[VERIFIER_ENV.clientSecret]!,
  };
}

/**
 * Writes credentials to a fresh owner-only (0600) temp file in the format
 * `readVerifierCredentials` accepts, and returns its path. Used to hand the
 * credential to one job subprocess, which deletes the file when it reads it.
 */
export function writeVerifierCredentialsFile(credentials: VerifierCredentials): string {
  const dir = mkdtempSync(join(tmpdir(), 'a0-verifier-'));
  const path = join(dir, 'credentials.json');
  writeFileSync(
    path,
    JSON.stringify({
      domain: credentials.domain,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
    { mode: 0o600 },
  );
  return path;
}
