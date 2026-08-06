/**
 * Seeds a fake authenticated tenant into the auth0 CLI config so the real CLI
 * believes it is logged in and targets the local mock server.
 *
 * The CLI reads `$HOME/.config/auth0/config.json`, builds the Management API
 * base URL as `https://<domain>/api/v2/`, and skips the interactive login when
 * it finds a non-expired tenant. By setting the domain to `127.0.0.1:<port>`
 * with a dummy token and a far-future expiry, every `auth0 api …` and
 * high-level command hits the mock server with no auth and no network.
 *
 * The token is a syntactically-valid but meaningless JWT — it authorises
 * nothing (the mock ignores it) and must never resemble a real credential.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WriteAuth0CliConfigOptions {
  /** The loopback port the mock server listens on. */
  port: number;
  /** The loopback host. Defaults to 127.0.0.1. */
  host?: string;
}

/** A dummy JWT (header.payload.sig) — decodes to inert claims; grants nothing. */
const DUMMY_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJpc3MiOiJodHRwczovL21vY2subG9jYWwvIiwic3ViIjoibW9jayIsImF1ZCI6Im1vY2sifQ' +
  '.mock-signature-not-a-real-token';

/**
 * Writes the CLI config under `homeDir` and returns the path written. Uses a
 * far-future `expires_at` so the CLI never attempts a token refresh (which
 * would need a client secret we don't have).
 */
export function writeAuth0CliConfig(homeDir: string, options: WriteAuth0CliConfigOptions): string {
  const host = options.host ?? '127.0.0.1';
  const domain = `${host}:${options.port}`;

  const config = {
    install_id: '00000000-0000-0000-0000-000000000000',
    default_tenant: domain,
    tenants: {
      [domain]: {
        name: 'mock',
        domain,
        access_token: DUMMY_ACCESS_TOKEN,
        expires_at: '2999-12-31T23:59:59Z',
        client_id: 'mock_client_id',
        scopes: ['read:*', 'create:*', 'update:*', 'delete:*'],
      },
    },
  };

  const dir = join(homeDir, '.config', 'auth0');
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return configPath;
}
