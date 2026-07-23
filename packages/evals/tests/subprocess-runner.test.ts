/**
 * Tests for src/cli/subprocess-runner.ts
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
import { collectFromTempFiles } from '../src/cli/subprocess-runner.js';
import { makeTmpDir } from './tmp.js';

const tmpDir = makeTmpDir('subprocess_runner_test_');

describe('collectFromTempFiles', () => {
  it('returns an empty array when given no files', () => {
    expect(collectFromTempFiles([])).toEqual([]);
  });

  it('skips files that do not exist', () => {
    const result = collectFromTempFiles(['/does/not/exist.json']);
    expect(result).toEqual([]);
  });

  it('flattens results from a single valid temp file', () => {
    const dir = tmpDir();
    const f = join(dir, 'tmp.json');
    const records = [{ eval_id: 'react_quickstart', model: 'gpt-5.4', mode: 'baseline' }];
    writeFileSync(f, JSON.stringify(records), 'utf-8');

    expect(collectFromTempFiles([f])).toEqual(records);
  });

  it('flattens and concatenates results from multiple temp files', () => {
    const dir = tmpDir();
    const f1 = join(dir, 'tmp1.json');
    const f2 = join(dir, 'tmp2.json');
    const r1 = { eval_id: 'eval_a', model: 'gpt-5.4', mode: 'baseline' };
    const r2 = { eval_id: 'eval_b', model: 'gpt-5.4', mode: 'agent' };
    writeFileSync(f1, JSON.stringify([r1]), 'utf-8');
    writeFileSync(f2, JSON.stringify([r2]), 'utf-8');

    expect(collectFromTempFiles([f1, f2])).toEqual([r1, r2]);
  });

  it('deletes each temp file after reading it', () => {
    const dir = tmpDir();
    const f = join(dir, 'tmp.json');
    writeFileSync(f, JSON.stringify([{ eval_id: 'x', model: 'm', mode: 'baseline' }]), 'utf-8');

    collectFromTempFiles([f]);
    expect(existsSync(f)).toBe(false);
  });

  it('ignores corrupt JSON and still deletes the file', () => {
    const dir = tmpDir();
    const f = join(dir, 'corrupt.json');
    writeFileSync(f, '{ not valid json', 'utf-8');

    expect(collectFromTempFiles([f])).toEqual([]);
    expect(existsSync(f)).toBe(false);
  });

  it('skips non-array JSON payloads', () => {
    const dir = tmpDir();
    const f = join(dir, 'object.json');
    writeFileSync(f, JSON.stringify({ eval_id: 'x', model: 'm', mode: 'baseline' }), 'utf-8');

    expect(collectFromTempFiles([f])).toEqual([]);
  });

  it('handles a mix of valid, missing, and corrupt files', () => {
    const dir = tmpDir();
    const valid = join(dir, 'valid.json');
    const corrupt = join(dir, 'corrupt.json');
    const record = { eval_id: 'react_quickstart', model: 'gpt-5.4', mode: 'baseline' };
    writeFileSync(valid, JSON.stringify([record]), 'utf-8');
    writeFileSync(corrupt, '!!!', 'utf-8');

    const result = collectFromTempFiles([valid, '/missing.json', corrupt]);
    expect(result).toEqual([record]);
  });
});
