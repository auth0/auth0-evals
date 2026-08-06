/**
 * Request dispatch for the mock HTTP runtime.
 *
 * Given a method/path/body, matches the loaded manifests and applies the first
 * matching route's verb (or handler), returning a `{ status, body }` response.
 * Unmatched writes succeed non-emptily; unmatched reads return `{}`. This lets
 * the real auth0 CLI's request go through to a deterministic answer without the
 * mock having to enumerate every possible endpoint.
 */

import { loadManifests } from './manifest.js';
import { normalizePath, routeMatches } from './matcher.js';
import { createState } from './state.js';
import { applyVerb } from './verbs.js';
import type { MockResponse, MockServerConfig, HandlerContext } from './types.js';

export type HandlerFn = (ctx: HandlerContext) => unknown;
export type HandlerMap = Record<string, HandlerFn>;

export interface DispatchRequest {
  method: string;
  path: string;
  body?: string;
}

const WRITE_METHODS = new Set(['put', 'patch', 'post', 'delete']);

export function dispatch(req: DispatchRequest, config: MockServerConfig, handlers: HandlerMap = {}): MockResponse {
  const stripPrefixes = config.stripPrefixes ?? ['api/v2/'];
  const method = (req.method ?? '').toLowerCase();
  const path = normalizePath(req.path ?? '', stripPrefixes);
  const body = req.body ?? '';
  const state = createState(config.stateDir);

  const manifests = loadManifests(config.routesDirs);
  for (const manifest of manifests) {
    for (const route of manifest.routes) {
      if (!routeMatches(route.match, method, path)) continue;
      if (route.verb === 'handler') {
        const fn = handlers[route.handler!];
        if (!fn) continue; // unknown handler → keep searching, then fallthrough
        return { status: route.status ?? 200, body: fn({ method, path, body, state }) };
      }
      const fixturesDir = `${manifest.dir}/fixtures/${manifest.surface}`;
      const response = applyVerb(route, state, fixturesDir);
      if (response !== undefined) return response;
    }
  }

  // Fallthrough: unmatched writes succeed non-emptily; reads return {}.
  return WRITE_METHODS.has(method) ? { status: 200, body: { ok: true } } : { status: 200, body: {} };
}
