/**
 * Types for the declarative mock HTTP runtime.
 *
 * A mock "surface" is a set of routes for one Management API area (e.g.
 * `guardian`, `clients`). Routes are declared as data in `<surface>.routes.json`
 * manifests; the engine (see {@link ./engine.ts}) applies a verb per matched
 * route. This mirrors the CLI-replacement mock's model, but the request comes
 * from a real HTTP call the auth0 CLI makes rather than a fake argv.
 */

export interface MockState {
  has(key: string): boolean;
  set(key: string): void;
  clear(key: string): void;
}

export interface HandlerContext {
  /** Lowercased HTTP method, e.g. `get`, `post`. */
  method: string;
  /** Normalized path with the `api/v2/` prefix stripped, e.g. `clients/abc`. */
  path: string;
  /** Raw request body (as sent by the CLI), or '' for bodyless requests. */
  body: string;
  state: MockState;
}

export type RouteVerb = 'create' | 'set' | 'reflect' | 'static' | 'handler';

export interface RouteDef {
  /** `"<METHOD> <path>"`, where `*` matches exactly one path segment. */
  match: string;
  verb: RouteVerb;
  /** Dotted state key (e.g. `guardian.otp`) — required for create/set/reflect. */
  state?: string;
  /** Response body: inline JSON value, or a string naming a fixture file. */
  body?: unknown | string;
  /** `reflect` response when the state marker is present. */
  present?: unknown | string;
  /** `reflect` response when the state marker is absent. */
  absent?: unknown | string;
  /** Name of a function in the surface's `handlers.js` — required for `handler`. */
  handler?: string;
  /** Optional HTTP status for the response (default 200, or 201 for create/set). */
  status?: number;
}

export interface RouteManifest {
  surface: string;
  consumedBy?: string[];
  routes: RouteDef[];
  /** Absolute dir the manifest was loaded from (set by loadManifests). */
  dir?: string;
}

/** Result of applying a verb — a JSON-serialisable body plus an HTTP status. */
export interface MockResponse {
  status: number;
  body: unknown;
}

export interface MockServerConfig {
  /** Dirs to scan for `*.routes.json` manifests (each holds `fixtures/<surface>/`). */
  routesDirs: string[];
  /** Directory for filesystem-backed state markers (outside the graded workspace). */
  stateDir: string;
  /** Path prefixes stripped during normalization (e.g. `['api/v2/']`). */
  stripPrefixes?: string[];
}

export interface StartMockServerOptions extends MockServerConfig {
  /** PEM-encoded TLS certificate (leaf) served to the CLI. SAN must cover the host. */
  cert: string;
  /** PEM-encoded private key for {@link cert}. */
  key: string;
  /** Loopback port to bind. Defaults to 8443. */
  port?: number;
  /** Loopback host to bind. Defaults to 127.0.0.1. */
  host?: string;
  /** Handler map merged from every surface's `handlers.js`. */
  handlers?: Record<string, (ctx: HandlerContext) => unknown>;
}

export interface RunningMockServer {
  /** The port the server actually bound to. */
  port: number;
  /** The host the server bound to. */
  host: string;
  /** Stops the server; resolves once fully closed. */
  close(): Promise<void>;
}
