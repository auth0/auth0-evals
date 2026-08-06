/**
 * Run-lifecycle glue for HTTP-mocked CLI evals.
 *
 * `startMockCliForEval` is called once per eval run, before the agent starts,
 * when `evalDef.httpRoutesDir` is set. It:
 *   1. starts the mock HTTPS server on loopback (from the committed leaf cert),
 *   2. seeds the auth0 CLI config so the CLI targets `127.0.0.1:<port>`,
 *   3. sets `AUTH0_CLI_ANALYTICS=false` in `process.env` so the child agent's
 *      shell inherits it (telemetry off).
 *
 * The returned handle's `stop()` must be called in a `finally` so the server is
 * always torn down. State lives in a caller-provided dir OUTSIDE the graded
 * workspace so graders never see it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { startMockServer } from './server.js';
import { loadHandlers } from './handlers.js';
import { loadManifests, collectRefProblems } from './manifest.js';
import { writeAuth0CliConfig } from './cli-config.js';
import type { RunningMockServer } from './types.js';

/** Default loopback port the mock Management API binds. */
export const MOCK_CLI_PORT = 8443;

export interface StartMockCliOptions {
  /** The eval's `http-routes/` dir (from EvalDefinition.httpRoutesDir). */
  httpRoutesDir: string;
  /** Directory for state markers — must be OUTSIDE the graded workspace. */
  stateDir: string;
  /** Directory holding `mockServer.pem` / `mockServer.key` (the committed leaf). */
  certDir: string;
  /** HOME dir under which the CLI config is written. Defaults to $HOME. */
  homeDir?: string;
  /** Loopback port. Defaults to {@link MOCK_CLI_PORT}. */
  port?: number;
}

export interface MockCliHandle {
  server: RunningMockServer;
  /** Absolute path to the auth0 CLI config that was seeded. */
  cliConfigPath: string;
  stop(): Promise<void>;
}

/**
 * Starts the mock Management API and seeds the CLI config. Throws if the routes
 * reference missing fixtures (fail fast — a broken manifest would silently
 * fall through to `{}` at request time and mask the eval).
 */
export async function startMockCliForEval(options: StartMockCliOptions): Promise<MockCliHandle> {
  const { httpRoutesDir, stateDir, certDir } = options;
  const port = options.port ?? MOCK_CLI_PORT;
  const homeDir = options.homeDir ?? process.env.HOME;
  if (!homeDir) throw new Error('[mock-cli] HOME is not set — cannot seed auth0 CLI config');

  const certPath = join(certDir, 'mockServer.pem');
  const keyPath = join(certDir, 'mockServer.key');
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    throw new Error(
      `[mock-cli] mock server cert/key not found in ${certDir} (expected mockServer.pem + mockServer.key)`,
    );
  }

  const routesDirs = [httpRoutesDir];
  const problems = collectRefProblems(loadManifests(routesDirs));
  if (problems.length > 0) {
    throw new Error(`[mock-cli] route manifest problems:\n  - ${problems.join('\n  - ')}`);
  }

  const handlers = await loadHandlers(routesDirs);
  const server = await startMockServer({
    routesDirs,
    stateDir,
    cert: readFileSync(certPath, 'utf-8'),
    key: readFileSync(keyPath, 'utf-8'),
    port,
    handlers,
  });

  const cliConfigPath = writeAuth0CliConfig(homeDir, { port: server.port });
  // The child agent's shell inherits process.env; keep the CLI's telemetry off.
  process.env.AUTH0_CLI_ANALYTICS = 'false';

  logger.info(`  [mock-cli] Management API mock on https://127.0.0.1:${server.port}; CLI config at ${cliConfigPath}`);

  return {
    server,
    cliConfigPath,
    stop: async () => {
      await server.close();
    },
  };
}
