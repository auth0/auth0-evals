/**
 * Unit tests for the mock HTTP engine: path normalization, route matching,
 * verb application, state read-after-write, manifest validation, and dispatch
 * fallthrough.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from '../tmp.js';
import { normalizePath, routeMatches } from '../../src/mock-http/matcher.js';
import { createState } from '../../src/mock-http/state.js';
import { applyVerb } from '../../src/mock-http/verbs.js';
import { loadManifests, collectRefProblems } from '../../src/mock-http/manifest.js';
import { dispatch } from '../../src/mock-http/engine.js';
import type { RouteDef } from '../../src/mock-http/types.js';

const tmp = makeTmpDir('mockhttp_');

describe('normalizePath', () => {
  const strip = ['api/v2/'];
  it('strips scheme+host, leading slash, api/v2 prefix, and query', () => {
    expect(normalizePath('https://tenant.auth0.com/api/v2/clients?page=1', strip)).toBe('clients');
    expect(normalizePath('/api/v2/clients/abc', strip)).toBe('clients/abc');
    expect(normalizePath('api/v2/guardian/factors', strip)).toBe('guardian/factors');
    expect(normalizePath('clients/', strip)).toBe('clients');
  });
});

describe('routeMatches', () => {
  it('matches method + exact path', () => {
    expect(routeMatches('GET clients', 'get', 'clients')).toBe(true);
    expect(routeMatches('GET clients', 'post', 'clients')).toBe(false);
    expect(routeMatches('GET clients', 'get', 'clients/abc')).toBe(false);
  });
  it('treats * as a single path segment', () => {
    expect(routeMatches('PATCH clients/*', 'patch', 'clients/abc')).toBe(true);
    expect(routeMatches('PATCH clients/*', 'patch', 'clients/abc/def')).toBe(false);
  });
  it('tolerates a leading slash in the pattern path', () => {
    expect(routeMatches('GET /clients', 'get', 'clients')).toBe(true);
  });
});

describe('createState', () => {
  it('is a filesystem-backed read-after-write marker', () => {
    const state = createState(tmp());
    expect(state.has('clients.created')).toBe(false);
    state.set('clients.created');
    expect(state.has('clients.created')).toBe(true);
    state.clear('clients.created');
    expect(state.has('clients.created')).toBe(false);
  });
});

describe('applyVerb', () => {
  it('create marks state and returns 201 + body', () => {
    const state = createState(tmp());
    const route: RouteDef = { match: 'POST clients', verb: 'create', state: 'c.made', body: { ok: 1 } };
    const res = applyVerb(route, state, '/nonexistent');
    expect(res).toEqual({ status: 201, body: { ok: 1 } });
    expect(state.has('c.made')).toBe(true);
  });
  it('reflect returns present/absent by state', () => {
    const state = createState(tmp());
    const route: RouteDef = { match: 'GET clients', verb: 'reflect', state: 'c.made', present: [1], absent: [] };
    expect(applyVerb(route, state, '/x')).toEqual({ status: 200, body: [] });
    state.set('c.made');
    expect(applyVerb(route, state, '/x')).toEqual({ status: 200, body: [1] });
  });
  it('handler verb returns undefined (deferred to engine)', () => {
    const state = createState(tmp());
    expect(applyVerb({ match: 'GET x', verb: 'handler', handler: 'h' }, state, '/x')).toBeUndefined();
  });
});

describe('loadManifests + collectRefProblems', () => {
  it('loads valid manifests and flags missing fixtures', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'fixtures', 'clients'), { recursive: true });
    writeFileSync(join(dir, 'fixtures', 'clients', 'created.json'), '{"client_id":"abc"}');
    writeFileSync(
      join(dir, 'clients.routes.json'),
      JSON.stringify({
        surface: 'clients',
        routes: [
          { match: 'POST clients', verb: 'create', state: 'clients.made', body: 'created.json' },
          { match: 'GET missing', verb: 'static', body: 'nope.json' },
        ],
      }),
    );
    const manifests = loadManifests([dir]);
    expect(manifests).toHaveLength(1);
    expect(collectRefProblems(manifests)).toContain("clients: missing fixture 'nope.json'");
  });

  it('rejects a route with an un-namespaced state key', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'bad.routes.json'),
      JSON.stringify({ surface: 'bad', routes: [{ match: 'GET x', verb: 'reflect', state: 'nodot' }] }),
    );
    expect(() => loadManifests([dir])).toThrow(/must be namespaced/);
  });

  it('rejects an unknown verb', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'bad.routes.json'),
      JSON.stringify({ surface: 'bad', routes: [{ match: 'GET x', verb: 'frobnicate' }] }),
    );
    expect(() => loadManifests([dir])).toThrow(/unknown verb/);
  });
});

describe('dispatch', () => {
  function makeRoutesDir(): string {
    const dir = tmp();
    mkdirSync(join(dir, 'fixtures', 'clients'), { recursive: true });
    writeFileSync(join(dir, 'fixtures', 'clients', 'created.json'), '{"client_id":"abc123"}');
    writeFileSync(
      join(dir, 'clients.routes.json'),
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
    return dir;
  }

  it('routes create → reflect for read-after-write', () => {
    const routesDir = makeRoutesDir();
    const stateDir = tmp();
    const config = { routesDirs: [routesDir], stateDir };

    expect(dispatch({ method: 'GET', path: '/api/v2/clients' }, config)).toEqual({ status: 200, body: [] });
    expect(dispatch({ method: 'POST', path: '/api/v2/clients', body: '{}' }, config)).toEqual({
      status: 201,
      body: { client_id: 'abc123' },
    });
    expect(dispatch({ method: 'GET', path: '/api/v2/clients' }, config)).toEqual({
      status: 200,
      body: [{ client_id: 'abc123' }],
    });
  });

  it('falls through: unmatched writes → {ok:true}, reads → {}', () => {
    const config = { routesDirs: [tmp()], stateDir: tmp() };
    expect(dispatch({ method: 'GET', path: '/api/v2/tenants/settings' }, config)).toEqual({ status: 200, body: {} });
    expect(dispatch({ method: 'PATCH', path: '/api/v2/tenants/settings', body: '{}' }, config)).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it('invokes a handler when the verb is handler', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'echo.routes.json'),
      JSON.stringify({ surface: 'echo', routes: [{ match: 'POST echo', verb: 'handler', handler: 'echoBody' }] }),
    );
    const config = { routesDirs: [dir], stateDir: tmp() };
    const handlers = { echoBody: (ctx: { body: string }) => ({ received: ctx.body }) };
    expect(dispatch({ method: 'POST', path: '/api/v2/echo', body: 'hi' }, config, handlers)).toEqual({
      status: 200,
      body: { received: 'hi' },
    });
  });
});
