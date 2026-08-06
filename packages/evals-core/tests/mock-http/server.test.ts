/**
 * End-to-end test of the mock HTTPS server over real TLS.
 *
 * Uses the committed mock leaf cert (SAN IP 127.0.0.1) and trusts the committed
 * mock CA — mirroring how the real auth0 CLI (Go) trusts the baked CA in the
 * container. Exercises read-after-write and fallthrough through an actual
 * HTTPS request.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { request as httpsRequest } from 'node:https';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTmpDir } from '../tmp.js';
import { startMockServer } from '../../src/mock-http/server.js';
import type { RunningMockServer } from '../../src/mock-http/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CERT_DIR = resolve(__dirname, '../../../../docker/mock-ca');

const tmp = makeTmpDir('mockhttp_srv_');
let server: RunningMockServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function req(
  base: string,
  method: string,
  path: string,
  ca: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((res, rej) => {
    const r = httpsRequest(`${base}${path}`, { method, ca }, (resp) => {
      let d = '';
      resp.on('data', (c) => (d += c));
      resp.on('end', () => res({ status: resp.statusCode ?? 0, body: d }));
    });
    r.on('error', rej);
    if (body) r.write(body);
    r.end();
  });
}

describe('startMockServer (real TLS)', () => {
  it('serves create→reflect and fallthrough over HTTPS with the trusted CA', async () => {
    // The committed certs must exist; regenerated via scripts/gen-mock-ca.mjs.
    expect(existsSync(join(CERT_DIR, 'mockServer.pem'))).toBe(true);
    const cert = readFileSync(join(CERT_DIR, 'mockServer.pem'), 'utf-8');
    const key = readFileSync(join(CERT_DIR, 'mockServer.key'), 'utf-8');
    const ca = readFileSync(join(CERT_DIR, 'mockCA.pem'), 'utf-8');

    const routesDir = tmp();
    mkdirSync(join(routesDir, 'fixtures', 'clients'), { recursive: true });
    writeFileSync(join(routesDir, 'fixtures', 'clients', 'created.json'), '{"client_id":"abc123"}');
    writeFileSync(
      join(routesDir, 'clients.routes.json'),
      JSON.stringify({
        surface: 'clients',
        routes: [
          { match: 'POST clients', verb: 'create', state: 'clients.made', body: 'created.json' },
          {
            match: 'GET clients',
            verb: 'reflect',
            state: 'clients.made',
            present: [{ client_id: 'abc123' }],
            absent: [],
          },
        ],
      }),
    );

    // port 0 → OS assigns a free port, so the test never collides with 8443.
    server = await startMockServer({ routesDirs: [routesDir], stateDir: tmp(), cert, key, port: 0 });
    const base = `https://127.0.0.1:${server.port}/api/v2`;

    const before = await req(base, 'GET', '/clients', ca);
    expect(before.status).toBe(200);
    expect(JSON.parse(before.body)).toEqual([]);

    const created = await req(base, 'POST', '/clients', ca, '{}');
    expect(created.status).toBe(201);
    expect(JSON.parse(created.body)).toEqual({ client_id: 'abc123' });

    const after = await req(base, 'GET', '/clients', ca);
    expect(JSON.parse(after.body)).toEqual([{ client_id: 'abc123' }]);

    const unmapped = await req(base, 'GET', '/tenants/settings', ca);
    expect(JSON.parse(unmapped.body)).toEqual({});
  });
});
