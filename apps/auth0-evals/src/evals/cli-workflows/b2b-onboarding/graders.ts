import { GraderLevel, judge, ranCommandOneOf, secretNotExposed, tenantState } from '@a0/evals-graders';
import { ACME_CONNECTION, ACME_DISPLAY, ACME_ORG, GLOBEX_ORG, OPS_NAME, PORTAL_NAME } from './fixture.js';
import type { Organization, Snapshot } from './fixture.js';

// Graded on the tenant's real state after the run. The fixture seeds the
// Supplier Portal, the acme-users connection (already enabled for the Ops
// Console), and a Globex organization with its own connection; the agent
// creates the Acme organization and wires the connection and the portal to it.
// State graders (L4) decide whether the work is done; route graders (L5) check
// the typed command was used where one exists.

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

const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && b.every((v) => a.includes(v));

function acme(post: Snapshot): Organization | string {
  const found = post.orgs.filter((o) => o.name === ACME_ORG);
  return found[0] ?? `No organization named "${ACME_ORG}"`;
}

/** A seeded client or connection, minus the keys the task is allowed to change. */
function stable(
  snap: Snapshot,
  kind: 'clients' | 'connections',
  id: unknown,
  ignore: readonly string[] = [],
): Record<string, unknown> | undefined {
  const obj = snap[kind][String(id)];
  if (!obj) return undefined;
  // updated_at moves on any write, including the ones the task asks for.
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'updated_at' && !ignore.includes(k)));
}

function unchanged(
  pre: Snapshot,
  post: Snapshot,
  kind: 'clients' | 'connections',
  id: unknown,
  name: string,
  ignore: readonly string[] = [],
): true | string {
  const before = stable(pre, kind, id, ignore);
  // Missing before the run means the snapshot is broken, not that nothing changed.
  if (before === undefined) return `${name} missing from the pre-run snapshot`;
  const after = stable(post, kind, id, ignore);
  if (after === undefined) return `${name} was deleted`;
  // Report key names only; values can hold settings that should not be persisted.
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => !same(before[k], after[k]))
    .sort();
  return changed.length === 0 || `${name} was modified: ${changed.join(', ')}`;
}

// The two settings the task asks for on the portal. Every other field must match.
const PORTAL_ORG_FIELDS = ['organization_usage', 'organization_require_behavior'];

export function defineGraders() {
  return [
    // ── L3: Security ──────────────────────────────────────────────────────
    secretNotExposed(),

    // ── L4: Acme organization ─────────────────────────────────────────────
    tenantState<Snapshot>(
      `Created one "${ACME_ORG}" organization displayed as "${ACME_DISPLAY}"`,
      GraderLevel.L4,
      ({ pre, post }) => {
        const org = acme(post);
        if (typeof org === 'string') return org;
        if (org.display_name !== ACME_DISPLAY) return `"${ACME_ORG}" display name does not match the request`;
        const added = post.orgs.filter((o) => !pre.orgs.some((p) => p.id === o.id));
        return added.length === 1 || `${added.length} organizations were created, expected one`;
      },
    ),
    tenantState<Snapshot>(
      `Acme organization has exactly the ${ACME_CONNECTION} connection enabled`,
      GraderLevel.L4,
      ({ post, seeded }) => {
        const org = acme(post);
        if (typeof org === 'string') return org;
        const enabled = (post.orgConnections[org.id] ?? []).map((c) => c.connection_id);
        if (enabled.length === 0) return 'Acme organization has no enabled connections';
        return (
          sameSet(enabled, [String(seeded.acmeUsersId)]) ||
          `Acme organization has the wrong enabled connections, expected only ${ACME_CONNECTION}`
        );
      },
    ),

    // ── L4: Supplier Portal can use acme-users ────────────────────────────
    tenantState<Snapshot>(
      `${PORTAL_NAME} is enabled on the ${ACME_CONNECTION} connection`,
      GraderLevel.L4,
      ({ post, seeded }) =>
        post.acmeUsersClients.includes(String(seeded.supplierPortalId)) ||
        `${PORTAL_NAME} cannot use ${ACME_CONNECTION}`,
    ),
    tenantState<Snapshot>(
      `${ACME_CONNECTION} is still enabled for ${OPS_NAME} and no other new application`,
      GraderLevel.L4,
      ({ pre, post, seeded }) => {
        // Replacing the enabled client list instead of adding to it drops the Ops Console.
        if (!pre.acmeUsersClients.includes(String(seeded.opsConsoleId)))
          return `${OPS_NAME} missing from the pre-run ${ACME_CONNECTION} clients`;
        if (!post.acmeUsersClients.includes(String(seeded.opsConsoleId)))
          return `${OPS_NAME} was removed from ${ACME_CONNECTION}`;
        const expected = [...pre.acmeUsersClients, String(seeded.supplierPortalId)];
        const extra = post.acmeUsersClients.filter((id) => !expected.includes(id));
        return extra.length === 0 || `${extra.length} other applications were enabled on ${ACME_CONNECTION}`;
      },
    ),

    // ── L4: Supplier Portal organization settings ─────────────────────────
    tenantState<Snapshot>(`${PORTAL_NAME} requires an organization to sign in`, GraderLevel.L4, ({ post, seeded }) => {
      const usage = post.clients[String(seeded.supplierPortalId)]?.organization_usage;
      return (
        usage === 'require' || `${PORTAL_NAME} organization_usage is ${String(usage ?? 'unset')}, expected require`
      );
    }),
    tenantState<Snapshot>(
      `${PORTAL_NAME} asks for the organization before the login page`,
      GraderLevel.L4,
      ({ post, seeded }) => {
        const behavior = post.clients[String(seeded.supplierPortalId)]?.organization_require_behavior;
        return (
          behavior === 'pre_login_prompt' ||
          `${PORTAL_NAME} organization_require_behavior is ${String(behavior ?? 'unset')}, expected pre_login_prompt`
        );
      },
    ),

    // ── L4: Nothing else changed ──────────────────────────────────────────
    tenantState<Snapshot>(
      `${PORTAL_NAME} settings were otherwise not modified`,
      GraderLevel.L4,
      ({ pre, post, seeded }) =>
        unchanged(pre, post, 'clients', seeded.supplierPortalId, PORTAL_NAME, PORTAL_ORG_FIELDS),
    ),
    tenantState<Snapshot>(`${OPS_NAME} was not modified`, GraderLevel.L4, ({ pre, post, seeded }) =>
      unchanged(pre, post, 'clients', seeded.opsConsoleId, OPS_NAME),
    ),
    tenantState<Snapshot>(
      `${ACME_CONNECTION} connection settings were not modified`,
      GraderLevel.L4,
      ({ pre, post, seeded }) => unchanged(pre, post, 'connections', seeded.acmeUsersId, ACME_CONNECTION),
    ),
    tenantState<Snapshot>(
      `Globex organization and its connection were not modified`,
      GraderLevel.L4,
      ({ pre, post, seeded }) => {
        if (!pre.globex) return `${GLOBEX_ORG} missing from the pre-run snapshot`;
        if (!same(pre.globex, post.globex)) return `${GLOBEX_ORG} organization was modified or deleted`;
        const id = String(seeded.globexOrgId);
        if (!same(pre.orgConnections[id], post.orgConnections[id]))
          return `${GLOBEX_ORG} enabled connections were modified`;
        return unchanged(pre, post, 'connections', seeded.globexUsersId, `${GLOBEX_ORG} connection`);
      },
    ),

    // ── L5: Typed commands, not raw Management API calls ──────────────────
    // Keyed on a flag or value from the task so a `--help` probe does not
    // count. Enabling a connection on an organization has no typed command in
    // the CLI, so that step has no route grader.
    ranCommandOneOf([['orgs create', ACME_ORG]], 'Created the organization with `auth0 orgs create`', GraderLevel.L5),
    ranCommandOneOf(
      [['connections enabled-clients update', 'client_id']],
      'Enabled the portal on the connection with `auth0 connections enabled-clients update`',
      GraderLevel.L5,
    ),
    ranCommandOneOf(
      [['apps update', '--organization-usage']],
      'Set the organization settings with `auth0 apps update`',
      GraderLevel.L5,
    ),

    judge(
      // The judge sees commands but not their output, so it cannot map ids to
      // names. The state graders above check what changed on which resource.
      'The Supplier Portal and Ops Console applications, the acme-users and globex-users connections, and the Globex organization already existed on the tenant before the run. ' +
        'The trace shows the commands but not their output, so ids cannot be matched to names, and separate checks already verify the final tenant state. ' +
        "Did the agent look up the existing resources instead of creating new ones, create a single Acme organization, enable a connection on it, enable an application on that connection without replacing its other applications, update one application's organization settings, and avoid creating, updating, or deleting anything else?",
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
