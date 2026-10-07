/**
 * Tenant fixture lifecycle — runs an eval's fixture hooks around the agent.
 *
 *   openFixture()      seed → pre-run snapshot        (before the agent starts)
 *   session.snapshot() post-run snapshot              (after the agent exits)
 *   session.close()    cleanup, always, never throws  (in a `finally`)
 *
 * Snapshots are held in memory for graders and are never persisted: a tenant
 * read can include client secrets.
 */

import { randomBytes } from 'node:crypto';
import type { FixtureContext, FixtureDef, ManagementApi } from '@a0/evals-graders';
import { logger } from '../utils/logger.js';

/** Shorter values would match ordinary words in replies and code, failing `secretNotExposed` for no reason. */
const MIN_SECRET_LENGTH = 8;

export interface OpenFixtureOptions {
  /** Verifier-backed client. Never shared with the agent. */
  mgmt: ManagementApi;
  workspace: string;
  /** Override for tests; defaults to 8 random hex chars. */
  runId?: string;
}

export interface FixtureSession {
  readonly context: FixtureContext;
  /** Values registered with `ctx.registerSecret`, for `secretNotExposed`. */
  readonly secrets: readonly string[];
  /** Snapshot taken after seeding, before the agent starts. `undefined` when the fixture has no `snapshot` hook. */
  readonly pre: unknown;
  /** Takes the post-run snapshot. */
  snapshot(): Promise<unknown>;
  /** Runs `cleanup` once. Errors are logged, not thrown, so they never mask the run result. */
  close(): Promise<void>;
}

/**
 * Seeds the fixture and takes the pre-run snapshot. If either step throws,
 * cleanup runs before the error propagates so a failed seed leaves nothing behind.
 */
export async function openFixture(def: FixtureDef, options: OpenFixtureOptions): Promise<FixtureSession> {
  const secrets: string[] = [];
  const context: FixtureContext = {
    mgmt: options.mgmt,
    workspace: options.workspace,
    runId: options.runId ?? randomBytes(4).toString('hex'),
    seeded: {},
    registerSecret: (value: string) => {
      if (value.length < MIN_SECRET_LENGTH) {
        throw new Error(`registerSecret needs a value of at least ${MIN_SECRET_LENGTH} characters`);
      }
      secrets.push(value);
    },
  };

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (!def.cleanup) return;
    try {
      await def.cleanup(context);
      logger.info(`  [Fixture] Cleanup complete (run ${context.runId})`);
    } catch (e) {
      logger.warn(`  [Fixture] Cleanup failed (run ${context.runId}): ${String(e)}`);
    }
  };

  let pre: unknown;
  try {
    if (def.seed) {
      context.seeded = (await def.seed(context)) ?? {};
      logger.info(`  [Fixture] Seeded on ${options.mgmt.domain} (run ${context.runId})`);
    }
    if (def.snapshot) pre = await def.snapshot(context);
  } catch (e) {
    await close();
    throw e;
  }

  return {
    context,
    secrets,
    pre,
    snapshot: async () => (def.snapshot ? def.snapshot(context) : undefined),
    close,
  };
}
