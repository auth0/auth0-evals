/**
 * Loads handler maps from every `handlers.js` co-located with a route manifest.
 *
 * A surface that needs request-shaped logic beyond the declarative verbs ships
 * a `handlers.js` exporting a default map of `{ name: (ctx) => body }`. Routes
 * reference these by name via `{ "verb": "handler", "handler": "name" }`.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HandlerFn, HandlerMap } from './engine.js';

export async function loadHandlers(dirs: string[]): Promise<HandlerMap> {
  const handlers: HandlerMap = {};
  for (const dir of dirs) {
    const hFile = join(dir, 'handlers.js');
    if (!existsSync(hFile)) continue;
    const mod = (await import(pathToFileURL(hFile).href)) as { default?: Record<string, HandlerFn> };
    Object.assign(handlers, mod.default ?? {});
  }
  return handlers;
}
