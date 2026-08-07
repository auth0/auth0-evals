/**
 * The mock HTTPS server.
 *
 * Stands in for the Auth0 Management API. The real `auth0` CLI is configured
 * (via a seeded config, see {@link ./cli-config.ts}) to treat `127.0.0.1:<port>`
 * as its tenant domain, so it issues `https://127.0.0.1:<port>/api/v2/<path>`
 * requests. This server terminates that TLS with a cert whose CA is trusted by
 * the container, reads the request, and answers from the declarative manifests.
 *
 * Runs INSIDE the sandbox on loopback (allowed by the iptables policy) as the
 * unprivileged agent user — hence a non-privileged default port (8443).
 */

import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatch } from './engine.js';
import type { RunningMockServer, StartMockServerOptions } from './types.js';

const DEFAULT_PORT = 8443;
const DEFAULT_HOST = '127.0.0.1';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export async function startMockServer(options: StartMockServerOptions): Promise<RunningMockServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const handlers = options.handlers ?? {};
  const config = {
    routesDirs: options.routesDirs,
    stateDir: options.stateDir,
    stripPrefixes: options.stripPrefixes,
  };

  const server = createServer({ cert: options.cert, key: options.key }, (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const body = await readBody(req);
        const { status, body: responseBody } = dispatch(
          { method: req.method ?? 'GET', path: req.url ?? '/', body },
          config,
          handlers,
        );
        const payload = JSON.stringify(responseBody ?? {});
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(payload);
      } catch (e) {
        // Never crash the server on a bad request — answer with a 500 JSON body.
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'mock_server_error', message: e instanceof Error ? e.message : String(e) }));
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;

  return {
    port: boundPort,
    host,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
