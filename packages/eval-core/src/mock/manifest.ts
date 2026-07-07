import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RouteManifest, RouteDef, RouteVerb } from './types.js';

const VERBS: RouteVerb[] = ['create', 'set', 'reflect', 'static', 'handler'];

function validateRoute(r: RouteDef, file: string): void {
  if (typeof r.match !== 'string' || !r.match.includes(' ')) {
    throw new Error(`[mock] ${file}: route.match must be "<METHOD> <path>", got ${JSON.stringify(r.match)}`);
  }
  if (!VERBS.includes(r.verb)) {
    throw new Error(`[mock] ${file}: unknown verb '${r.verb}' (expected ${VERBS.join('|')})`);
  }
  if ((r.verb === 'create' || r.verb === 'set' || r.verb === 'reflect') && !r.state) {
    throw new Error(`[mock] ${file}: verb '${r.verb}' on '${r.match}' requires a 'state' key`);
  }
  if (r.state && !r.state.includes('.')) {
    throw new Error(`[mock] ${file}: state key '${r.state}' must be namespaced with a dot (e.g. feature.thing)`);
  }
  if (r.verb === 'handler' && !r.handler) {
    throw new Error(`[mock] ${file}: verb 'handler' on '${r.match}' requires a 'handler' name`);
  }
}

export function loadManifests(dirs: string[]): RouteManifest[] {
  const manifests: RouteManifest[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.routes.json')) continue;
      const file = join(dir, entry);
      let parsed: RouteManifest;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf-8')) as RouteManifest;
      } catch (e) {
        throw new Error(`[mock] ${file}: invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!parsed.surface || !Array.isArray(parsed.routes)) {
        throw new Error(`[mock] ${file}: manifest needs 'surface' and 'routes[]'`);
      }
      for (const r of parsed.routes) validateRoute(r, file);
      manifests.push(parsed);
    }
  }
  return manifests;
}

export function resolveBody(ref: unknown, fixturesDir: string): unknown {
  if (typeof ref !== 'string') return ref;
  const path = join(fixturesDir, ref);
  return JSON.parse(readFileSync(path, 'utf-8'));
}
