import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MockState } from './types.js';

// Encode a dotted/slashy state key into a flat, filesystem-safe marker name.
function markerName(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function createState(dir: string): MockState {
  mkdirSync(dir, { recursive: true });
  return {
    has: (key) => existsSync(join(dir, markerName(key))),
    set: (key) => writeFileSync(join(dir, markerName(key)), ''),
    clear: (key) => rmSync(join(dir, markerName(key)), { force: true }),
  };
}
