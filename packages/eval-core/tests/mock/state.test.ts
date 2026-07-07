import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createState } from '../../src/mock/state.js';

describe('createState', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mockstate-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports a key as absent until set', () => {
    const s = createState(dir);
    expect(s.has('cte.action')).toBe(false);
    s.set('cte.action');
    expect(s.has('cte.action')).toBe(true);
  });

  it('clears a key', () => {
    const s = createState(dir);
    s.set('x'); s.clear('x');
    expect(s.has('x')).toBe(false);
  });

  it('encodes dotted/slashy keys into a safe filename', () => {
    const s = createState(dir);
    s.set('cte.action/deploy');
    expect(s.has('cte.action/deploy')).toBe(true);
  });
});
