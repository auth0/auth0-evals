/**
 * Tenant fixture definitions for evals that run against a live Auth0 tenant.
 *
 * A fixture owns tenant state outside the agent loop: it seeds prerequisites
 * before the agent starts, snapshots tenant state before and after the run, and
 * removes run-owned resources at the end. Every call goes through a verifier
 * Management API client the agent never sees, so the agent cannot fake or
 * observe what the fixture reads.
 *
 * This module holds only the authoring surface. The runtime (Management API
 * client, credential loading, lifecycle) lives in `@a0/evals-core`.
 */

/** Minimal Management API v2 client handed to fixture hooks. Paths are relative to `/api/v2/`. */
export interface ManagementApi {
  /** Tenant domain the client targets, e.g. `acme-dev.us.auth0.com`. */
  readonly domain: string;
  get<T = unknown>(path: string, query?: Record<string, string | number | boolean>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
}

/** Context passed to every fixture hook. */
export interface FixtureContext {
  /** Verifier-backed Management API client. */
  mgmt: ManagementApi;
  /** Absolute path to the agent workspace. Seed may write task inputs here. */
  workspace: string;
  /**
   * Short unique id for this run. Use it in names of run-owned resources
   * (e.g. `eval-legacy-${runId}`) so cleanup deletes only what this run created.
   */
  runId: string;
  /** Values returned by `seed`, e.g. ids of seeded resources. Empty when `seed` returns nothing. */
  seeded: Record<string, unknown>;
  /**
   * Registers a secret the agent must never expose, such as a credential the
   * fixture minted on the tenant. `secretNotExposed` checks every registered
   * value plus the verifier credential. Throws for values under 8 characters.
   * Do not register a value the fixture writes into the workspace: it is there
   * before the agent runs, so the grader would always fail.
   */
  registerSecret(value: string): void;
}

/** Hooks a fixture may implement. All are optional. */
export interface FixtureDef {
  /**
   * Creates prerequisites before the agent starts. Returned values become `ctx.seeded`.
   * If `seed` throws partway, `seeded` stays empty when `cleanup` runs, so cleanup
   * should also find run-owned resources by `runId` rather than only by `seeded` ids.
   */
  seed?(ctx: FixtureContext): Promise<Record<string, unknown> | void>;
  /**
   * Reads the tenant state the eval cares about. Called once before the agent
   * starts and once after it exits; graders compare the two.
   */
  snapshot?(ctx: FixtureContext): Promise<unknown>;
  /** Removes run-owned resources. Always runs, even when seeding or the agent fails. */
  cleanup?(ctx: FixtureContext): Promise<void>;
}

/**
 * Declares an eval's tenant fixture. Export the result as the default export of
 * `fixture.ts` in the eval directory.
 *
 *     export default defineFixture({
 *       async seed({ mgmt, runId }) {
 *         const app = await mgmt.post<{ client_id: string }>('clients', { name: `Legacy Admin ${runId}` });
 *         return { legacyAdminId: app.client_id };
 *       },
 *       async snapshot({ mgmt, seeded }) {
 *         return { legacyAdmin: await mgmt.get(`clients/${seeded.legacyAdminId}`) };
 *       },
 *       async cleanup({ mgmt, seeded }) {
 *         if (seeded.legacyAdminId) await mgmt.delete(`clients/${seeded.legacyAdminId}`);
 *       },
 *     });
 */
export function defineFixture(def: FixtureDef): FixtureDef {
  return def;
}
