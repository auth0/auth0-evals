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
  token_endpoint_auth_method?: string;
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
  /** Every other client on the tenant, non-secret fields only, sorted by client_id. */
  otherClients: Client[];
  apis: ResourceServer[];
  /** Every grant on the Orders API, plus every grant held by a seeded client. */
  grants: ClientGrant[];
  /** Full seeded client objects, keyed by id, with the secret replaced by a hash. A deleted client is left out. */
  sentinels: Record<string, Record<string, unknown>>;
}

const CLIENT_FIELDS =
  'client_id,name,app_type,callbacks,allowed_logout_urls,web_origins,allowed_origins,grant_types,token_endpoint_auth_method,client_metadata';

/** The Management API client rejects with a `status` on any HTTP error. */
function isNotFound(e: unknown): boolean {
  return (
    (e as { name?: string; status?: number } | undefined)?.name === 'ManagementApiError' &&
    (e as { status?: number }).status === 404
  );
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
      try {
        const { client_secret, ...rest } = await mgmt.get<Record<string, unknown>>(`clients/${id}`);
        sentinels[id] = {
          ...rest,
          client_secret_sha256: createHash('sha256').update(String(client_secret)).digest('hex'),
        };
      } catch (e) {
        // A deleted client is a result for the graders, not a reason to lose the whole snapshot.
        if (!isNotFound(e)) throw e;
      }
    }
    return {
      clients: clients.filter((c) => ids.includes(c.client_id) || c.name === PORTAL_NAME),
      otherClients: clients
        .filter((c) => !ids.includes(c.client_id) && c.name !== PORTAL_NAME)
        .sort((a, b) => a.client_id.localeCompare(b.client_id)),
      apis: (await listApis(mgmt)).filter((a) => a.identifier === ORDERS_AUDIENCE || a.name === 'Orders API'),
      grants,
      sentinels,
    } satisfies Snapshot;
  },

  async cleanup({ mgmt, seeded, runId }) {
    // Seeded clients are deleted by their recorded ids. The eval_run lookup is
    // a fallback in case seed stopped early. Only look for the agent's
    // resources when seed proved the tenant started without them. Every delete
    // is attempted even if discovery or an earlier delete fails, so one error
    // does not leave the rest behind to trip the clean-tenant guard next run.
    // Auth0 removes a client's grants when the client is deleted.
    const paths = new Set<string>();
    let discoveryFailures = 0;
    for (const id of [seeded.fulfillmentWorkerId, seeded.legacyAdminId]) {
      if (typeof id === 'string' && id) paths.add(`clients/${id}`);
    }
    try {
      for (const c of await listClients(mgmt)) {
        if (c.client_metadata?.eval_run === runId) paths.add(`clients/${c.client_id}`);
        if (seeded.fulfillmentWorkerId && c.name === PORTAL_NAME) paths.add(`clients/${c.client_id}`);
      }
    } catch {
      discoveryFailures++;
    }
    if (seeded.fulfillmentWorkerId) {
      try {
        for (const a of await listApis(mgmt))
          if (a.identifier === ORDERS_AUDIENCE) paths.add(`resource-servers/${a.id}`);
      } catch {
        discoveryFailures++;
      }
    }
    const results = await Promise.allSettled(
      [...paths].map((p) =>
        // Already gone, for example deleted by the agent.
        mgmt.delete(p).catch((e: unknown) => {
          if (!isNotFound(e)) throw e;
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0 || discoveryFailures > 0)
      throw new Error(`${failed} of ${paths.size} cleanup deletes failed, ${discoveryFailures} lookups failed`);
  },
});
