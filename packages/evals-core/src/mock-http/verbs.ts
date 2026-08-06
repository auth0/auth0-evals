/**
 * Verb application for the mock HTTP runtime.
 *
 * Each matched route declares a verb that maps request → response:
 *   - `create`/`set` — mark state, respond with `body` (default 201)
 *   - `reflect`      — respond `present`/`absent` based on the state marker
 *   - `static`       — always respond with `body`
 *   - `handler`      — deferred to the engine's handler map (returns undefined)
 */

import { resolveBody } from './manifest.js';
import type { RouteDef, MockState, MockResponse } from './types.js';

// Apply a declarative verb → { status, body }. Returns undefined for 'handler'
// (the engine calls the handler instead).
export function applyVerb(route: RouteDef, state: MockState, fixturesDir: string): MockResponse | undefined {
  switch (route.verb) {
    case 'create':
    case 'set':
      state.set(route.state!);
      return { status: route.status ?? 201, body: resolveBody(route.body, fixturesDir) };
    case 'reflect':
      return {
        status: route.status ?? 200,
        body: state.has(route.state!)
          ? resolveBody(route.present, fixturesDir)
          : resolveBody(route.absent, fixturesDir),
      };
    case 'static':
      return { status: route.status ?? 200, body: resolveBody(route.body, fixturesDir) };
    default:
      return undefined;
  }
}
