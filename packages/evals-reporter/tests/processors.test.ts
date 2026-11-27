/**
 * Unit tests for src/report/processors.ts — loadScores error handling.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScores, summariseBySplit } from '../src/report/processors.js';
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

describe('summariseBySplit', () => {
  const RESULTS: Record<string, unknown>[] = [
    { eval_id: 'mfa_react', model: 'm', mode: 'agent', split: 'tuning', grader_pass_rate: 0.8 },
    { eval_id: 'mfa_vue', model: 'm', mode: 'agent', split: 'tuning', grader_pass_rate: 1.0 },
    { eval_id: 'passkeys_react', model: 'm', mode: 'agent', split: 'heldout', grader_pass_rate: 0.5 },
    { eval_id: 'passkeys_vue', model: 'm', mode: 'agent', split: 'heldout', status: 'error' },
  ];

  it('averages tuning results on their own', () => {
    const tuning = summariseBySplit(RESULTS).tuning.agent!;
    expect(tuning.runs).toBe(2);
    expect(tuning.meanPassRate).toBeCloseTo(0.9);
  });

  it('counts held-out errors as runs but leaves them out of the mean', () => {
    expect(summariseBySplit(RESULTS).heldout.agent).toEqual({ runs: 2, meanPassRate: 0.5 });
  });

  it('puts results with no split under unlabelled, keyed by variant', () => {
    const summary = summariseBySplit([
      { eval_id: 'x', model: 'm', mode: 'agent', tools: ['skills'], grader_pass_rate: 1 },
    ]);
    expect(summary.unlabelled['agent+skills']).toEqual({ runs: 1, meanPassRate: 1 });
    expect(summary.tuning).toEqual({});
  });

  it('gives a null mean when a variant has only errors', () => {
    const summary = summariseBySplit([{ eval_id: 'x', model: 'm', mode: 'agent', split: 'heldout', status: 'error' }]);
    expect(summary.heldout.agent).toEqual({ runs: 1, meanPassRate: null });
  });
});
