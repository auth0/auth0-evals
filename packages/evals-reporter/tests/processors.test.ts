/**
 * Unit tests for src/report/processors.ts — loadScores error handling.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScores } from '../src/report/processors.js';
import { makeTmpDir } from './tmp.js';

const tmpDir = makeTmpDir('processors_test_');

describe('loadScores', () => {
  it('loads and concatenates arrays from multiple files', () => {
    const dir = tmpDir();
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    writeFileSync(a, JSON.stringify([{ eval_id: 'x' }]));
    writeFileSync(b, JSON.stringify([{ eval_id: 'y' }, { eval_id: 'z' }]));

    const results = loadScores([a, b]);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.eval_id)).toEqual(['x', 'y', 'z']);
  });

  it('throws with the file path when a file contains invalid JSON', () => {
    const dir = tmpDir();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ not valid json');

    expect(() => loadScores([bad])).toThrow(new RegExp(`Failed to parse scores file .*bad\\.json`));
  });

  it('preserves the underlying parse error as `cause`', () => {
    const dir = tmpDir();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ not valid json');

    try {
      loadScores([bad]);
      expect.fail('expected loadScores to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBeInstanceOf(Error);
    }
  });

  it('throws with the file path when the JSON is not an array', () => {
    const dir = tmpDir();
    const obj = join(dir, 'obj.json');
    writeFileSync(obj, JSON.stringify({ eval_id: 'x' }));

    expect(() => loadScores([obj])).toThrow(new RegExp(`Scores file .*obj\\.json must contain a JSON array`));
  });
});
