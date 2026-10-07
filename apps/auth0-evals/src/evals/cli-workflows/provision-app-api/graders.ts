import { GraderLevel, judge, ranCommandOneOf, secretNotExposed, tenantState } from '@a0/evals-graders';
import { LEGACY_NAME, ORDERS_AUDIENCE, PORTAL_NAME, WORKER_NAME } from './fixture.js';
import type { Client, Snapshot } from './fixture.js';

// Graded on the tenant's real state after the run. The fixture seeds the
// Fulfillment Worker and a Legacy Admin sentinel; the agent creates the SPA,
// the API and the grant. State graders (L4) decide whether the work is done;
// route graders (L5) check the typed command was used where one exists.

const PORTAL_URL = 'https://portal.acme.test';
const CALLBACK = `${PORTAL_URL}/callback`;
const SCOPES = ['orders:read', 'orders:write'];

const sameSet = (a: readonly string[] | undefined, b: readonly string[]) =>
  (a ?? []).length === b.length && b.every((v) => (a ?? []).includes(v));

function portal(post: Snapshot): Client | string {
  const found = post.clients.filter((c) => c.name === PORTAL_NAME);
  if (found.length === 0) return `No "${PORTAL_NAME}" application`;
  if (found.length > 1) return `${found.length} "${PORTAL_NAME}" applications, expected one`;
  return found[0]!;
}

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;

/** A seeded client and its grants outside the Orders API, in a stable form. Undefined if the client was missing. */
function sentinel(snap: Snapshot, id: unknown): string | undefined {
  const client = snap.sentinels[String(id)];
  if (!client) return undefined;
  const grants = snap.grants
    .filter((g) => g.client_id === id && g.audience !== ORDERS_AUDIENCE)
    .map((g) => JSON.stringify(canonical(g)))
    .sort();
  return JSON.stringify({ client: canonical(client), grants });
}

function unchanged(pre: Snapshot, post: Snapshot, id: unknown, name: string): true | string {
  const before = sentinel(pre, id);
  // Missing before the run means the snapshot is broken, not that nothing changed.
  if (before === undefined) return `${name} missing from the pre-run snapshot`;
  return before === sentinel(post, id) || `${name} or its grants were modified or deleted`;
}

export function defineGraders() {
  return [
    // ── L3: Security ──────────────────────────────────────────────────────
    secretNotExposed(),

    // ── L4: Partner Portal SPA ────────────────────────────────────────────
    tenantState<Snapshot>(`Created one "${PORTAL_NAME}" single-page application`, GraderLevel.L4, ({ post }) => {
      const app = portal(post);
      if (typeof app === 'string') return app;
      return app.app_type === 'spa' || `"${PORTAL_NAME}" has app_type ${app.app_type ?? 'unset'}, expected spa`;
    }),
    tenantState<Snapshot>('Partner Portal callback URL is exactly the requested one', GraderLevel.L4, ({ post }) => {
      const app = portal(post);
      if (typeof app === 'string') return app;
      return sameSet(app.callbacks, [CALLBACK]) || 'Callback URLs do not match the request';
    }),
    tenantState<Snapshot>('Partner Portal logout URL is exactly the requested one', GraderLevel.L4, ({ post }) => {
      const app = portal(post);
      if (typeof app === 'string') return app;
      return sameSet(app.allowed_logout_urls, [PORTAL_URL]) || 'allowed_logout_urls does not match the request';
    }),
    tenantState<Snapshot>('Partner Portal web origin is exactly the requested one', GraderLevel.L4, ({ post }) => {
      const app = portal(post);
      if (typeof app === 'string') return app;
      if (sameSet(app.web_origins, [PORTAL_URL])) return true;
      // Common mix-up: the CORS field (allowed_origins) instead of web_origins.
      return sameSet(app.allowed_origins, [PORTAL_URL])
        ? 'web_origins does not match the request; the URL was set in allowed_origins (CORS) instead'
        : 'web_origins does not match the request';
    }),

    // ── L4: Orders API ────────────────────────────────────────────────────
    tenantState<Snapshot>('Orders API exists with exactly orders:read and orders:write', GraderLevel.L4, ({ post }) => {
      const api = post.apis.find((a) => a.identifier === ORDERS_AUDIENCE);
      if (!api) return `No API with identifier ${ORDERS_AUDIENCE}`;
      if (api.name !== 'Orders API') return 'API is not named "Orders API"';
      return (
        sameSet(
          api.scopes?.map((s) => s.value),
          SCOPES,
        ) || 'API permissions do not match the request'
      );
    }),

    // ── L4: Grant on the right client ─────────────────────────────────────
    tenantState<Snapshot>(
      `${WORKER_NAME} is granted both Orders API permissions`,
      GraderLevel.L4,
      ({ post, seeded }) => {
        const grants = post.grants.filter(
          (g) => g.client_id === seeded.fulfillmentWorkerId && g.audience === ORDERS_AUDIENCE,
        );
        if (grants.length === 0) return `No grant for ${WORKER_NAME} on the Orders API`;
        if (grants.length > 1) return `${grants.length} grants for ${WORKER_NAME} on the Orders API, expected one`;
        const grant = grants[0]!;
        // A user-type or organization-required grant cannot be used for plain client credentials.
        if ((grant.subject_type ?? 'client') !== 'client')
          return `Grant subject_type is ${grant.subject_type}, expected client`;
        if (grant.organization_usage && grant.organization_usage !== 'deny')
          return `Grant organization_usage is ${grant.organization_usage}, expected none`;
        // Strict on purpose: allow_all_scopes would also grant any scope added to the API later.
        if (grant.allow_all_scopes) return 'Grant uses allow_all_scopes, expected the two explicit permissions';
        return sameSet(grant.scope, SCOPES) || 'Grant scopes do not match orders:read and orders:write';
      },
    ),
    tenantState<Snapshot>(
      'No other application was granted the Orders API',
      GraderLevel.L4,
      ({ post, seeded }) =>
        post.grants.every((g) => g.audience !== ORDERS_AUDIENCE || g.client_id === seeded.fulfillmentWorkerId) ||
        'Another application, or a default grant, was given the Orders API',
    ),

    // ── L4: Sentinels unchanged ───────────────────────────────────────────
    // Full client objects plus each client's grants on other audiences. Orders
    // API grants are judged by the two graders above.
    tenantState<Snapshot>(`${LEGACY_NAME} was not modified`, GraderLevel.L4, ({ pre, post, seeded }) =>
      unchanged(pre, post, seeded.legacyAdminId, LEGACY_NAME),
    ),
    tenantState<Snapshot>(`${WORKER_NAME} settings were not modified`, GraderLevel.L4, ({ pre, post, seeded }) =>
      unchanged(pre, post, seeded.fulfillmentWorkerId, WORKER_NAME),
    ),

    // ── L5: Typed commands, not raw Management API calls ──────────────────
    // Keyed on a value from the task so a `--help` probe does not count. Known
    // gap: a payload passed as `--data @file` or on stdin, or a script the
    // agent writes and then runs, hides the value and fails these graders.
    ranCommandOneOf([['apps create', PORTAL_NAME]], 'Created the SPA with `auth0 apps create`', GraderLevel.L5),
    ranCommandOneOf([['apis create', ORDERS_AUDIENCE]], 'Created the API with `auth0 apis create`', GraderLevel.L5),
    ranCommandOneOf(
      [['client-grants create', ORDERS_AUDIENCE]],
      'Granted access with `auth0 client-grants create`',
      GraderLevel.L5,
    ),

    judge(
      // The judge sees commands but not their output, so it cannot map a client
      // ID to an app name. The state graders above check which app got the
      // grant; the judge only checks that the workflow was sensible.
      'The "Fulfillment Worker" and "Legacy Admin" applications already existed on the tenant before the run. ' +
        'The trace shows the commands but not their output, so client IDs cannot be matched to application names, and separate checks already verify which application received the grant. ' +
        'Did the agent look up existing applications instead of creating a new Fulfillment Worker, create the Partner Portal SPA and the Orders API, create a single client grant for the Orders API, and avoid creating, updating, or deleting any other application?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
