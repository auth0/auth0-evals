/**
 * Tenant fixture lifecycle — runs an eval's fixture hooks around the agent.
 *
 *   openFixture()          seed → pre-run snapshot        (before the agent starts)
 *   session.capturePost()  post-run snapshot              (after the agent exits)
 *   session.gradingInput() state and secrets for graders  (after capturePost)
 *   session.close()        cleanup, always, never throws  (in a `finally`)
 *
 * Snapshots are held in memory for graders. They are persisted only masked, in the
 * run artefact of the agent phase (see artifact-data.ts), and never in the scores
 * file: a tenant read can include client secrets.
 */

import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { MIN_SECRET_LENGTH } from '@a0/evals-graders';
import type { FixtureContext, FixtureDef, ManagementApi } from '@a0/evals-graders';
import type { FixtureGradingInput } from '../graders/engine.js';
import { logger } from '../utils/logger.js';
import { redactKnownSecrets } from '../utils/redact.js';

export interface OpenFixtureOptions {
  /** Verifier-backed client. Never shared with the agent. */
  mgmt: ManagementApi;
  workspace: string;
  /** Override for tests; defaults to 8 random hex chars. */
  runId?: string;
  /** Credentials the verifier uses, always treated as known secrets alongside values registered with `ctx.registerSecret`. */
  extraSecrets?: readonly string[];
}

export interface FixtureSession {
  readonly context: FixtureContext;
  /** Values registered with `ctx.registerSecret`, for `secretNotExposed`. */
  readonly secrets: readonly string[];
  /** Snapshot taken after seeding, before the agent starts. `undefined` when the fixture has no `snapshot` hook. */
  readonly pre: unknown;
  /** Takes the post-run snapshot and keeps it in the session. No-op when the fixture has no `snapshot` hook. */
  capturePost(): Promise<void>;
  /** State and secrets for the graders. State needs `capturePost` first, secrets are available at any time. */
  gradingInput(): FixtureGradingInput;
  /** Runs `cleanup` once. Errors are logged, not thrown, so they never mask the run result. */
  close(): Promise<void>;
}

/**
 * Returns the error unchanged when nothing printed for it (message, stack, `cause` chain) holds a
 * known secret. Otherwise returns a new error with the message masked and no cause, because a
 * failed open has no session for the caller to read the secrets from, and the CLI prints the
 * whole error with its causes.
 */
function redactError(e: unknown, secrets: readonly string[]): unknown {
  const known = secrets.filter((s) => s.length > 0);
  if (known.length === 0) return e;
  // `customInspect: false` so an error with a throwing `inspect.custom` hook cannot replace the
  // fixture failure with its own. When the error cannot be printed at all, treat it as unsafe.
  let printed: string | undefined;
  try {
    printed = e instanceof Error ? inspect(e, { customInspect: false }) : String(e);
  } catch {
    printed = undefined;
  }
  if (printed !== undefined && !known.some((s) => printed.includes(s))) return e;
  let message: string;
  try {
    message = e instanceof Error ? e.message : String(e);
  } catch {
    message = 'Fixture failed';
  }
  const safe = new Error(redactKnownSecrets(message, known));
  if (e instanceof Error) safe.name = redactKnownSecrets(String(e.name), known);
  return safe;
}

/**
 * Seeds the fixture and takes the pre-run snapshot. If either step throws,
 * cleanup runs before the error propagates so a failed seed leaves nothing behind.
 * An error that quotes a known secret is masked before it propagates.
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

  // Read at call time, so secrets registered later are included.
  const knownSecrets = (): string[] => [...(options.extraSecrets ?? []), ...secrets];

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (!def.cleanup) return;
    try {
      await def.cleanup(context);
      logger.info(`  [Fixture] Cleanup complete (run ${context.runId})`);
    } catch (e) {
      logger.warn(
        `  [Fixture] Cleanup failed (run ${context.runId}): ${redactKnownSecrets(String(e), knownSecrets())}`,
      );
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
    // The session never reaches the caller, so this is the last place that still knows the secrets.
    throw redactError(e, knownSecrets());
  }

  let post: unknown;
  return {
    context,
    secrets,
    pre,
    capturePost: async () => {
      if (def.snapshot) post = await def.snapshot(context);
    },
    gradingInput: () => ({
      // Without a snapshot hook there is no state, so tenant_state graders say so instead of crashing.
      state: def.snapshot ? { pre, post, seeded: context.seeded } : undefined,
      secrets: knownSecrets(),
    }),
    close,
  };
}
