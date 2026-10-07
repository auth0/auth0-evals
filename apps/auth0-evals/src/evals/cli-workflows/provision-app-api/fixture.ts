import { createHash } from 'node:crypto';
import { defineFixture } from '@a0/evals-graders';
import type { ManagementApi } from '@a0/evals-graders';

// Seeds the M2M client the agent must grant ("Fulfillment Worker") and a
// sentinel app ("Legacy Admin") the agent must not touch. The Partner Portal
// SPA, the Orders API and the grant are the answer, so they are not seeded.

export const WORKER_NAME = 'Fulfillment Worker';
export const LEGACY_NAME = 'Legacy Admin';
export const PORTAL_NAME = 'Partner Portal';
export const ORDERS_AUDIENCE = 'https://orders.acme.test';

export interface Client {
  client_id: string;
  name: string;
  app_type?: string;
  callbacks?: string[];
  allowed_logout_urls?: string[];
  web_origins?: string[];
  allowed_origins?: string[];
  grant_types?: string[];
  client_metadata?: Record<string, string>;
}

export interface ResourceServer {
  id: string;
  name: string;
  identifier: string;
  scopes?: { value: string }[];
}

export interface ClientGrant {
  id: string;
  client_id?: string;
  audience: string;
  scope?: string[];
  allow_all_scopes?: boolean;
  subject_type?: string;
  organization_usage?: string;
  default_for?: string;
}

export interface Snapshot {
  /** Agent-visible clients: the seeded pair and any Partner Portal. */
  clients: Client[];
  apis: ResourceServer[];
  /** Every grant on the Orders API, plus every grant held by a seeded client. */
  grants: ClientGrant[];
  /** Full seeded client objects, keyed by id, with the secret replaced by a hash. */
  sentinels: Record<string, Record<string, unknown>>;
}

const CLIENT_FIELDS =
  'client_id,name,app_type,callbacks,allowed_logout_urls,web_origins,allowed_origins,grant_types,client_metadata';

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

const listClients = (mgmt: ManagementApi) =>
  listAll<Client>(mgmt, 'clients', 'clients', { fields: CLIENT_FIELDS, include_fields: 'true' });
const listApis = (mgmt: ManagementApi) => listAll<ResourceServer>(mgmt, 'resource-servers', 'resource_servers');

export default defineFixture({
  async seed({ mgmt, runId, registerSecret }) {
    // These names are fixed by the prompt, so a leftover from an earlier run
    // would make the task ambiguous. Refuse to start instead of deleting
    // something this run did not create.
    const clients = await listClients(mgmt);
    const taken = clients.filter((c) => [WORKER_NAME, LEGACY_NAME, PORTAL_NAME].includes(c.name)).map((c) => c.name);
    if ((await listApis(mgmt)).some((a) => a.identifier === ORDERS_AUDIENCE)) taken.push(ORDERS_AUDIENCE);
    if (taken.length > 0) throw new Error(`Tenant is not clean, already has: ${[...new Set(taken)].join(', ')}`);

    const worker = await mgmt.post<{ client_id: string; client_secret: string }>('clients', {
      name: WORKER_NAME,
      app_type: 'non_interactive',
      grant_types: ['client_credentials'],
      client_metadata: { eval_run: runId },
    });
    registerSecret(worker.client_secret);
    const legacy = await mgmt.post<{ client_id: string; client_secret: string }>('clients', {
      name: LEGACY_NAME,
      app_type: 'regular_web',
      callbacks: ['https://admin.acme.test/callback'],
      allowed_logout_urls: ['https://admin.acme.test'],
      client_metadata: { eval_run: runId },
    });
    registerSecret(legacy.client_secret);
    return { fulfillmentWorkerId: worker.client_id, legacyAdminId: legacy.client_id };
  },

  async snapshot({ mgmt, seeded }) {
    const clients = await listClients(mgmt);
    const ids = [seeded.fulfillmentWorkerId, seeded.legacyAdminId].map(String);
    // Query by audience, not by client, so a grant to any other client (or a
    // `default_for` grant with no client) is visible to the graders.
    const grantLists = await Promise.all([
      listAll<ClientGrant>(mgmt, 'client-grants', 'client_grants', { audience: ORDERS_AUDIENCE }),
      ...ids.map((id) => listAll<ClientGrant>(mgmt, 'client-grants', 'client_grants', { client_id: id })),
    ]);
    const grants = [...new Map(grantLists.flat().map((g) => [g.id, g])).values()];
    const sentinels: Snapshot['sentinels'] = {};
    for (const id of ids) {
      const { client_secret, ...rest } = await mgmt.get<Record<string, unknown>>(`clients/${id}`);
      sentinels[id] = {
        ...rest,
        client_secret_sha256: createHash('sha256').update(String(client_secret)).digest('hex'),
      };
    }
    return {
      clients: clients.filter((c) => ids.includes(c.client_id) || c.name === PORTAL_NAME),
      apis: (await listApis(mgmt)).filter((a) => a.identifier === ORDERS_AUDIENCE || a.name === 'Orders API'),
      grants,
      sentinels,
    } satisfies Snapshot;
  },

  async cleanup({ mgmt, seeded, runId }) {
    // Seeded clients carry this run's id. Only look for the agent's resources
    // when seed got far enough to prove the tenant started without them.
    // Each delete is attempted even if an earlier one fails, so one error does
    // not leave the rest behind to trip the clean-tenant guard next run.
    const paths: string[] = [];
    const clients = await listClients(mgmt);
    for (const c of clients) {
      if (c.client_metadata?.eval_run === runId) paths.push(`clients/${c.client_id}`);
    }
    if (seeded.fulfillmentWorkerId) {
      for (const c of clients) if (c.name === PORTAL_NAME) paths.push(`clients/${c.client_id}`);
      for (const a of await listApis(mgmt))
        if (a.identifier === ORDERS_AUDIENCE) paths.push(`resource-servers/${a.id}`);
    }
    const failed = (await Promise.allSettled(paths.map((p) => mgmt.delete(p)))).filter((r) => r.status === 'rejected');
    if (failed.length > 0) throw new Error(`${failed.length} of ${paths.length} cleanup deletes failed`);
  },
});
