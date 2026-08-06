/**
 * @a0/evals-core mock-http — a declarative mock of the Auth0 Management API.
 *
 * Instead of replacing the `auth0` CLI binary, this runs the REAL CLI and
 * intercepts its HTTPS calls with a local server driven by `*.routes.json`
 * manifests. See ./README.md for the manifest format and CA regeneration.
 */

export { startMockServer } from './server.js';
export { startMockCliForEval, MOCK_CLI_PORT } from './lifecycle.js';
export { dispatch } from './engine.js';
export { loadManifests, collectRefProblems, resolveBody } from './manifest.js';
export { loadHandlers } from './handlers.js';
export { writeAuth0CliConfig } from './cli-config.js';
export type { HandlerFn, HandlerMap, DispatchRequest } from './engine.js';
export type { WriteAuth0CliConfigOptions } from './cli-config.js';
export type { StartMockCliOptions, MockCliHandle } from './lifecycle.js';
export type {
  RouteManifest,
  RouteDef,
  RouteVerb,
  HandlerContext,
  MockState,
  MockResponse,
  MockServerConfig,
  StartMockServerOptions,
  RunningMockServer,
} from './types.js';
