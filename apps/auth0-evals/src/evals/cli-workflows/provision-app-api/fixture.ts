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

/** A client as the Management API returns it, with secret-bearing members replaced by a hash. */
export type OtherClient = Record<string, unknown> & { client_id: string };

export interface Snapshot {
  /** Agent-visible clients: the seeded pair and any Partner Portal. */
  clients: Client[];
  /** Every other client on the tenant, in full, sorted by client_id. Secret-bearing members are hashed. */
  otherClients: OtherClient[];
  /** Every grant held by one of the other clients, keyed by client_id and sorted. */
  otherGrants: Record<string, ClientGrant[]>;
  apis: ResourceServer[];
  /** Every grant on the Orders API, plus every grant held by a seeded client. */
  grants: ClientGrant[];
  /** Full seeded client objects, keyed by id, with the secret replaced by a hash. A deleted client is left out. */
  sentinels: Record<string, Record<string, unknown>>;
}

const CLIENT_FIELD_LIST = [
  'client_id',
  'name',
  'app_type',
  'callbacks',
  'allowed_logout_urls',
  'web_origins',
  'allowed_origins',
  'grant_types',
  'token_endpoint_auth_method',
  'client_metadata',
];
const CLIENT_FIELDS = CLIENT_FIELD_LIST.join(',');

// Members of another client that can hold a secret or key material. They are
// compared by hash and never written to the snapshot.
const HASHED_MEMBERS = ['client_secret', 'signing_keys', 'encryption_key', 'addons', 'client_authentication_methods'];

/** Same value with object keys in a stable order, for comparing and hashing. */
export const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;

const sha256 = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');

/** The full client with each secret-bearing member swapped for `<member>_sha256`. */
function redactClient(client: Record<string, unknown>): OtherClient {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(client)) {
    if (HASHED_MEMBERS.includes(key)) out[`${key}_sha256`] = sha256(value);
    else out[key] = value;
  }
  return out as OtherClient;
}

/**
 * True only for a Management API 404 on `GET`/`DELETE` of exactly `path`. A 404 from the
 * token endpoint or any other path is not "the client is gone" and must surface.
 */
function isNotFound(e: unknown, method: 'GET' | 'DELETE', path: string): boolean {
  const err = e as { name?: string; status?: number; method?: string; path?: string } | undefined;
  return err?.name === 'ManagementApiError' && err.status === 404 && err.method === method && err.path === path;
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
    const allClients = await listAll<Record<string, unknown> & { client_id: string; name: string }>(
      mgmt,
      'clients',
      'clients',
    );
    const ids = [seeded.fulfillmentWorkerId, seeded.legacyAdminId].map(String);
    // Query by audience, not by client, so a grant to any other client (or a
    // `default_for` grant with no client) is visible to the graders.
    const [audienceGrants, everyGrant, ...seededGrants] = await Promise.all([
      listAll<ClientGrant>(mgmt, 'client-grants', 'client_grants', { audience: ORDERS_AUDIENCE }),
      listAll<ClientGrant>(mgmt, 'client-grants', 'client_grants'),
      ...ids.map((id) => listAll<ClientGrant>(mgmt, 'client-grants', 'client_grants', { client_id: id })),
    ]);
    const grants = [...new Map([...audienceGrants, ...seededGrants.flat()].map((g) => [g.id, g])).values()];
    const isOther = (c: { client_id: string; name: string }) => !ids.includes(c.client_id) && c.name !== PORTAL_NAME;
    const otherClients = allClients
      .filter(isOther)
      .map(redactClient)
      .sort((a, b) => a.client_id.localeCompare(b.client_id));
    const otherGrants: Snapshot['otherGrants'] = {};
    for (const client of otherClients) {
      otherGrants[client.client_id] = everyGrant
        .filter((g) => g.client_id === client.client_id)
        .sort((a, b) => a.id.localeCompare(b.id));
    }
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
        if (!isNotFound(e, 'GET', `clients/${id}`)) throw e;
      }
    }
    return {
      clients: allClients
        .filter((c) => !isOther(c))
        .map(
          (c) => Object.fromEntries(CLIENT_FIELD_LIST.filter((k) => k in c).map((k) => [k, c[k]])) as unknown as Client,
        ),
      otherClients,
      otherGrants,
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
          if (!isNotFound(e, 'DELETE', p)) throw e;
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0 || discoveryFailures > 0)
      throw new Error(`${failed} of ${paths.size} cleanup deletes failed, ${discoveryFailures} lookups failed`);
  },
});
