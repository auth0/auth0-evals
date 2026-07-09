import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifests } from '../../src/mock/manifest.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'manifest-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeManifest(name: string, obj: unknown) {
  writeFileSync(join(dir, name), JSON.stringify(obj));
}

describe('loadManifests', () => {
  it('loads a valid manifest', () => {
    writeManifest('x.routes.json', {
      surface: 'x',
      routes: [{ match: 'GET x', verb: 'static', body: { ok: true } }],
    });
    const m = loadManifests([dir]);
    expect(m).toHaveLength(1);
    expect(m[0]!.routes[0]!.verb).toBe('static');
  });

  it('rejects an unknown verb', () => {
    writeManifest('bad.routes.json', {
      surface: 'bad', routes: [{ match: 'GET x', verb: 'frobnicate' }],
    });
    expect(() => loadManifests([dir])).toThrow(/verb/i);
  });

  it('rejects an un-namespaced state key (no dot)', () => {
    writeManifest('bad.routes.json', {
      surface: 'bad', routes: [{ match: 'POST x', verb: 'create', state: 'created', body: {} }],
    });
    expect(() => loadManifests([dir])).toThrow(/namespace|dot/i);
  });

  it('ignores non-manifest files', () => {
    writeFileSync(join(dir, 'README.md'), '# not a manifest');
    expect(loadManifests([dir])).toHaveLength(0);
  });
});
