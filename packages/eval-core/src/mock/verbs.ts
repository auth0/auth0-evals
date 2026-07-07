import { resolveBody } from './manifest.js';
import type { RouteDef, MockState } from './types.js';

// Apply a declarative verb → response object. Returns undefined for 'handler'
// (the engine calls the handler instead).
export function applyVerb(route: RouteDef, state: MockState, fixturesDir: string): unknown {
  switch (route.verb) {
    case 'create':
    case 'set':
      state.set(route.state!);
      return resolveBody(route.body, fixturesDir);
    case 'reflect':
      return state.has(route.state!)
        ? resolveBody(route.present, fixturesDir)
        : resolveBody(route.absent, fixturesDir);
    case 'static':
      return resolveBody(route.body, fixturesDir);
    default:
      return undefined;
  }
}
