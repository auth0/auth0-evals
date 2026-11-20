import { createHash } from 'node:crypto';
import { defineFixture } from '@a0/evals-graders';
import type { ManagementApi } from '@a0/evals-graders';

// Seeds the app Acme will sign in to ("Supplier Portal"), the database
// connection Acme's employees use ("acme-users", already enabled for a sentinel
// app "Ops Console"), and a protected organization "globex" with its own
// connection. The Acme organization, its enabled connection, the portal's
// access to acme-users and its organization settings are the answer, so they
// are not seeded.

export const PORTAL_NAME = 'Supplier Portal';
export const OPS_NAME = 'Ops Console';
export const ACME_ORG = 'acme';
export const ACME_DISPLAY = 'Acme Corp';
export const ACME_CONNECTION = 'acme-users';
export const GLOBEX_ORG = 'globex';
export const GLOBEX_CONNECTION = 'globex-users';

export interface Organization {
  id: string;
  name: string;
  display_name?: string;
  metadata?: Record<string, string>;
}

export interface EnabledConnection {
  connection_id: string;
  assign_membership_on_login?: boolean;
}

export interface Connection {
  id: string;
  name: string;
  metadata?: Record<string, string>;
}

export interface Snapshot {
  /** Every organization on the tenant, so a duplicate or extra org is visible. */
  orgs: Organization[];
  /** Enabled connections of the acme and globex organizations, keyed by org id. */
  orgConnections: Record<string, EnabledConnection[]>;
  /** Client ids that can use the acme-users connection, or null when the connection is gone. */
  acmeUsersClients: string[] | null;
  /** Full seeded clients keyed by id, with the secret replaced by a hash. Null when deleted. */
  clients: Record<string, Record<string, unknown> | null>;
  /** Full seeded connections keyed by id, without their enabled clients. Null when deleted. */
  connections: Record<string, Record<string, unknown> | null>;
  /** The full globex organization object, or null when it is gone. */
  globex: Record<string, unknown> | null;
  /** Ids of every application on the tenant, so a created or deleted one is visible. */
  clientIds: string[];
  /** Ids of every connection on the tenant, so a created or deleted one is visible. */
  connectionIds: string[];
}

const isNotFound = (e: unknown): boolean => (e as { status?: unknown } | null | undefined)?.status === 404;

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Reads a resource the agent may have deleted. Only a 404 counts as missing; anything else is rethrown. */
async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

interface Created {
  orgs: string[];
  connections: string[];
  clients: string[];
}

/**
 * Deletes organizations first because they reference connections, then connections,
 * then applications. Every delete is attempted even when another fails, and a 404
 * counts as already gone. Returns one line per failure.
 */
async function deleteAll(mgmt: ManagementApi, created: Created): Promise<string[]> {
  const failures: string[] = [];
  const stages: [string, string[]][] = [
    ['organizations', created.orgs],
    ['connections', created.connections],
    ['clients', created.clients],
  ];
  for (const [path, ids] of stages) {
    const unique = [...new Set(ids)];
    const results = await Promise.allSettled(unique.map((id) => mgmt.delete(`${path}/${id}`)));
    results.forEach((r, i) => {
      if (r.status === 'rejected' && !isNotFound(r.reason))
        failures.push(`delete ${path}/${unique[i]}: ${errorText(r.reason)}`);
    });
  }
  return failures;
}

async function listAll<T>(
  mgmt: ManagementApi,
  path: string,
  key: string,
  query: Record<string, string> = {},
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const res = await mgmt.get<Record<string, T[]>>(path, { ...query, page, per_page: 100, include_totals: true });
    const items = res[key] ?? [];
    out.push(...items);
    if (items.length < 100) return out;
  }
}

/** Client ids enabled on a connection. This endpoint pages with a `next` cursor. */
async function connectionClients(mgmt: ManagementApi, id: string): Promise<string[]> {
  const out: string[] = [];
  let from: string | undefined;
  do {
    const res = await mgmt.get<{ clients: { client_id: string }[]; next?: string }>(`connections/${id}/clients`, {
      take: 100,
      ...(from ? { from } : {}),
    });
    out.push(...res.clients.map((c) => c.client_id));
    from = res.next;
  } while (from);
  return out;
}

const listOrgs = (mgmt: ManagementApi) => listAll<Organization>(mgmt, 'organizations', 'organizations');
const listClients = (mgmt: ManagementApi) =>
  listAll<{ client_id: string; name: string; client_metadata?: Record<string, string> }>(mgmt, 'clients', 'clients', {
    fields: 'client_id,name,client_metadata',
    include_fields: 'true',
  });
const listConnections = (mgmt: ManagementApi) => listAll<Connection>(mgmt, 'connections', 'connections');

export default defineFixture({
  async seed({ mgmt, runId, registerSecret }) {
    // These names are fixed by the prompt, so a leftover from an earlier run
    // would make the task ambiguous. Refuse to start instead of deleting
    // something this run did not create.
    const taken = [
      ...(await listClients(mgmt)).filter((c) => [PORTAL_NAME, OPS_NAME].includes(c.name)).map((c) => c.name),
      ...(await listOrgs(mgmt)).filter((o) => [ACME_ORG, GLOBEX_ORG].includes(o.name)).map((o) => `org ${o.name}`),
      ...(await listConnections(mgmt))
        .filter((c) => [ACME_CONNECTION, GLOBEX_CONNECTION].includes(c.name))
        .map((c) => `connection ${c.name}`),
    ];
    if (taken.length > 0) throw new Error(`Tenant is not clean, already has: ${[...new Set(taken)].join(', ')}`);

    // Everything written is recorded so a failed write undoes the earlier ones.
    // A write whose response was lost is not recorded; the run-wide cleanup finds
    // it by the run id in its metadata.
    const made: Created = { orgs: [], connections: [], clients: [] };
    try {
      const tag = { eval_run: runId };
      const portal = await mgmt.post<{ client_id: string; client_secret: string }>('clients', {
        name: PORTAL_NAME,
        app_type: 'regular_web',
        oidc_conformant: true,
        callbacks: ['https://suppliers.acme.test/callback'],
        allowed_logout_urls: ['https://suppliers.acme.test'],
        client_metadata: tag,
      });
      made.clients.push(portal.client_id);
      registerSecret(portal.client_secret);
      const ops = await mgmt.post<{ client_id: string; client_secret: string }>('clients', {
        name: OPS_NAME,
        app_type: 'regular_web',
        oidc_conformant: true,
        callbacks: ['https://ops.acme.test/callback'],
        client_metadata: tag,
      });
      made.clients.push(ops.client_id);
      registerSecret(ops.client_secret);

      const acmeUsers = await mgmt.post<Connection>('connections', {
        name: ACME_CONNECTION,
        strategy: 'auth0',
        metadata: tag,
      });
      made.connections.push(acmeUsers.id);
      await mgmt.patch(`connections/${acmeUsers.id}/clients`, [{ client_id: ops.client_id, status: true }]);
      const globexUsers = await mgmt.post<Connection>('connections', {
        name: GLOBEX_CONNECTION,
        strategy: 'auth0',
        metadata: tag,
      });
      made.connections.push(globexUsers.id);
      const globex = await mgmt.post<Organization>('organizations', {
        name: GLOBEX_ORG,
        display_name: 'Globex Inc',
        metadata: tag,
      });
      made.orgs.push(globex.id);
      await mgmt.post(`organizations/${globex.id}/enabled_connections`, {
        connection_id: globexUsers.id,
        assign_membership_on_login: false,
      });

      return {
        supplierPortalId: portal.client_id,
        opsConsoleId: ops.client_id,
        acmeUsersId: acmeUsers.id,
        globexUsersId: globexUsers.id,
        globexOrgId: globex.id,
      };
    } catch (e) {
      const failures = await deleteAll(mgmt, made);
      if (failures.length === 0) throw e;
      throw new Error(`${errorText(e)} (rollback also failed: ${failures.join('; ')})`, { cause: e });
    }
  },

  async snapshot({ mgmt, seeded }) {
    const orgs = await listOrgs(mgmt);
    const orgConnections: Snapshot['orgConnections'] = {};
    for (const o of orgs.filter((o) => [ACME_ORG, GLOBEX_ORG].includes(o.name))) {
      const enabled = await orNull(() =>
        listAll<EnabledConnection>(mgmt, `organizations/${o.id}/enabled_connections`, 'enabled_connections'),
      );
      if (enabled) orgConnections[o.id] = enabled;
    }
    // A seeded resource the agent deleted reads as null, so the graders can
    // report it instead of the whole snapshot failing.
    const clients: Snapshot['clients'] = {};
    for (const id of [seeded.supplierPortalId, seeded.opsConsoleId].map(String)) {
      const client = await orNull(() => mgmt.get<Record<string, unknown>>(`clients/${id}`));
      if (!client) {
        clients[id] = null;
        continue;
      }
      const { client_secret, ...rest } = client;
      clients[id] = {
        ...rest,
        client_secret_sha256: createHash('sha256').update(String(client_secret)).digest('hex'),
      };
    }
    const connections: Snapshot['connections'] = {};
    for (const id of [seeded.acmeUsersId, seeded.globexUsersId].map(String)) {
      // Enabled clients are graded on their own, so a legitimate change there
      // does not count as editing the connection.
      const connection = await orNull(() => mgmt.get<Record<string, unknown>>(`connections/${id}`));
      if (connection) delete connection.enabled_clients;
      connections[id] = connection;
    }
    return {
      orgs,
      orgConnections,
      acmeUsersClients: await orNull(() => connectionClients(mgmt, String(seeded.acmeUsersId))),
      clients,
      connections,
      globex: await orNull(() => mgmt.get<Record<string, unknown>>(`organizations/${seeded.globexOrgId}`)),
      clientIds: (await listClients(mgmt)).map((c) => c.client_id),
      connectionIds: (await listConnections(mgmt)).map((c) => c.id),
    } satisfies Snapshot;
  },

  async cleanup({ mgmt, seeded, runId }) {
    // Seeded resources are removed by the ids seed recorded, so a metadata edit
    // by the agent cannot hide them. The run id in the metadata is a fallback for
    // when seed failed partway and recorded nothing. The agent's acme org has no
    // known id, so it is found by name, and only when seed got far enough to prove
    // the tenant started without one. Every step is attempted even if an earlier
    // one fails, and the failures are reported together.
    const failures: string[] = [];
    const find = async <T>(what: string, list: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await list();
      } catch (e) {
        failures.push(`list ${what}: ${errorText(e)}`);
        return [];
      }
    };
    const seededId = (key: string): string[] => {
      const id = seeded[key];
      return typeof id === 'string' && id ? [id] : [];
    };

    const orgs = await find('organizations', () => listOrgs(mgmt));
    const connections = await find('connections', () => listConnections(mgmt));
    const clients = await find('applications', () => listClients(mgmt));
    failures.push(
      ...(await deleteAll(mgmt, {
        orgs: [
          ...seededId('globexOrgId'),
          ...orgs
            .filter((o) => o.metadata?.eval_run === runId || (seeded.globexOrgId && o.name === ACME_ORG))
            .map((o) => o.id),
        ],
        connections: [
          ...seededId('acmeUsersId'),
          ...seededId('globexUsersId'),
          ...connections.filter((c) => c.metadata?.eval_run === runId).map((c) => c.id),
        ],
        clients: [
          ...seededId('supplierPortalId'),
          ...seededId('opsConsoleId'),
          ...clients.filter((c) => c.client_metadata?.eval_run === runId).map((c) => c.client_id),
        ],
      })),
    );
    if (failures.length > 0) throw new Error(`Cleanup failed: ${failures.join('; ')}`);
  },
});
