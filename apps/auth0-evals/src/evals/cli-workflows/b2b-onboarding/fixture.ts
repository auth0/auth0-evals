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
  /** Client ids that can use the acme-users connection. */
  acmeUsersClients: string[];
  /** Full seeded clients keyed by id, with the secret replaced by a hash. */
  clients: Record<string, Record<string, unknown>>;
  /** Full seeded connections keyed by id, without their enabled clients. */
  connections: Record<string, Record<string, unknown>>;
  /** The full globex organization object. */
  globex: Record<string, unknown> | null;
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

    const tag = { eval_run: runId };
    const portal = await mgmt.post<{ client_id: string; client_secret: string }>('clients', {
      name: PORTAL_NAME,
      app_type: 'regular_web',
      oidc_conformant: true,
      callbacks: ['https://suppliers.acme.test/callback'],
      allowed_logout_urls: ['https://suppliers.acme.test'],
      client_metadata: tag,
    });
    registerSecret(portal.client_secret);
    const ops = await mgmt.post<{ client_id: string; client_secret: string }>('clients', {
      name: OPS_NAME,
      app_type: 'regular_web',
      oidc_conformant: true,
      callbacks: ['https://ops.acme.test/callback'],
      client_metadata: tag,
    });
    registerSecret(ops.client_secret);

    const acmeUsers = await mgmt.post<Connection>('connections', {
      name: ACME_CONNECTION,
      strategy: 'auth0',
      metadata: tag,
    });
    await mgmt.patch(`connections/${acmeUsers.id}/clients`, [{ client_id: ops.client_id, status: true }]);
    const globexUsers = await mgmt.post<Connection>('connections', {
      name: GLOBEX_CONNECTION,
      strategy: 'auth0',
      metadata: tag,
    });
    const globex = await mgmt.post<Organization>('organizations', {
      name: GLOBEX_ORG,
      display_name: 'Globex Inc',
      metadata: tag,
    });
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
  },

  async snapshot({ mgmt, seeded }) {
    const orgs = await listOrgs(mgmt);
    const orgConnections: Snapshot['orgConnections'] = {};
    for (const o of orgs.filter((o) => [ACME_ORG, GLOBEX_ORG].includes(o.name))) {
      orgConnections[o.id] = await listAll<EnabledConnection>(
        mgmt,
        `organizations/${o.id}/enabled_connections`,
        'enabled_connections',
      );
    }
    const clients: Snapshot['clients'] = {};
    for (const id of [seeded.supplierPortalId, seeded.opsConsoleId].map(String)) {
      const { client_secret, ...rest } = await mgmt.get<Record<string, unknown>>(`clients/${id}`);
      clients[id] = {
        ...rest,
        client_secret_sha256: createHash('sha256').update(String(client_secret)).digest('hex'),
      };
    }
    const connections: Snapshot['connections'] = {};
    for (const id of [seeded.acmeUsersId, seeded.globexUsersId].map(String)) {
      // Enabled clients are graded on their own, so a legitimate change there
      // does not count as editing the connection.
      const connection = await mgmt.get<Record<string, unknown>>(`connections/${id}`);
      delete connection.enabled_clients;
      connections[id] = connection;
    }
    return {
      orgs,
      orgConnections,
      acmeUsersClients: await connectionClients(mgmt, String(seeded.acmeUsersId)),
      clients,
      connections,
      globex: await mgmt.get<Record<string, unknown>>(`organizations/${seeded.globexOrgId}`).catch(() => null),
    } satisfies Snapshot;
  },

  async cleanup({ mgmt, seeded, runId }) {
    // Organizations go first because they reference the connections. Seeded
    // resources carry this run's id; the agent's acme org is only removed when
    // seed got far enough to prove the tenant started without one. Each delete
    // in a stage is attempted even if another fails.
    let failed = 0;
    const run = async (paths: string[]) => {
      const results = await Promise.allSettled(paths.map((p) => mgmt.delete(p)));
      failed += results.filter((r) => r.status === 'rejected').length;
    };
    await run(
      (await listOrgs(mgmt))
        .filter((o) => o.metadata?.eval_run === runId || (seeded.globexOrgId && o.name === ACME_ORG))
        .map((o) => `organizations/${o.id}`),
    );
    await run(
      (await listConnections(mgmt)).filter((c) => c.metadata?.eval_run === runId).map((c) => `connections/${c.id}`),
    );
    await run(
      (await listClients(mgmt))
        .filter((c) => c.client_metadata?.eval_run === runId)
        .map((c) => `clients/${c.client_id}`),
    );
    if (failed > 0) throw new Error(`${failed} cleanup deletes failed`);
  },
});
