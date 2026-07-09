import { loadManifests } from './manifest.js';
import { normalizePath, routeMatches } from './matcher.js';
import { createState } from './state.js';
import { applyVerb } from './verbs.js';
import type { EngineConfig, HandlerContext } from './types.js';

export type HandlerFn = (ctx: HandlerContext) => unknown;
export type HandlerMap = Record<string, HandlerFn>;

export async function runMockCli(
  argv: string[],
  config: EngineConfig,
  handlers: HandlerMap = {},
): Promise<string> {
  const [sub, method, rawPath] = argv;
  if (sub !== 'api') {
    // Non-api subcommands (e.g. login) are no-op successes.
    if (sub === 'login') return `✓ Successfully logged in (mock)`;
    return `auth0 (mock): ok`;
  }
  const path = normalizePath(rawPath ?? '', config.stripPrefixes);
  const payload = argv.join(' ');
  const state = createState(config.stateDir);

  const manifests = loadManifests(config.manifestDirs);
  for (const manifest of manifests) {
    for (const route of manifest.routes) {
      if (!routeMatches(route.match, method ?? '', path)) continue;
      if (route.verb === 'handler') {
        const fn = handlers[route.handler!];
        if (!fn) continue; // unknown handler → keep searching, then fallthrough
        return JSON.stringify(fn({ method: (method ?? '').toLowerCase(), path, payload, state }));
      }
      // manifestDirs entries hold fixtures/<surface>/ alongside the manifest.
      const fixturesDir = `${manifest.dir}/fixtures/${manifest.surface}`;
      return JSON.stringify(applyVerb(route, state, fixturesDir));
    }
  }

  // Fallthrough: unmatched writes succeed non-emptily; reads return {}.
  const m = (method ?? '').toLowerCase();
  return ['put', 'patch', 'post', 'delete'].includes(m) ? '{"ok":true}' : '{}';
}
