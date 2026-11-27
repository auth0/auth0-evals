import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import { EvalConfigError } from '../src/errors.js';
import { applySplits, loadSplitFile, loadSplitsForEvals, validateSplitFile } from '../src/splits/index.js';
import type { SplitFile } from '../src/splits/index.js';
import type { EvalConfig } from '../src/loader.js';

const createTmpDir = makeTmpDir('splits_');
const FILE = '/repo/eval-splits.json';

function evalsOf(category: string, count: number): EvalConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${category.replace(/-/g, '_')}_${i}`,
    name: `${category} ${i}`,
    category,
    path: `src/evals/${category}/sdk${i}`,
  }));
}

const EVALS: EvalConfig[] = [...evalsOf('mfa', 3), ...evalsOf('passkeys', 3), ...evalsOf('rbac', 1)];

function validFile(): SplitFile {
  return {
    families: { mfa: 'tuning', passkeys: 'heldout', rbac: 'tuning' },
    pairs: [['mfa', 'passkeys']],
    history: [{ date: '2026-11-26', heldout: ['passkeys'] }],
  };
}

function expectConfigError(fn: () => void, ...fragments: string[]): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(EvalConfigError);
  const message = (caught as Error).message;
  for (const f of fragments) expect(message).toContain(f);
}

describe('applySplits', () => {
  it('labels each eval with its family split', () => {
    const labelled = applySplits(EVALS, validFile());
    expect(labelled.filter((e) => e.category === 'mfa').every((e) => e.split === 'tuning')).toBe(true);
    expect(labelled.filter((e) => e.category === 'passkeys').every((e) => e.split === 'heldout')).toBe(true);
  });

  it('does not mutate the input configs', () => {
    applySplits(EVALS, validFile());
    expect(EVALS.every((e) => e.split === undefined)).toBe(true);
  });
});

describe('validateSplitFile', () => {
  it('accepts a valid file', () => {
    expect(() => validateSplitFile(validFile(), EVALS, FILE)).not.toThrow();
  });

  it('rejects a discovered family with no label', () => {
    const file = validFile();
    delete file.families.rbac;
    expectConfigError(() => validateSplitFile(file, EVALS, FILE), 'rbac', 'start as "tuning"', FILE);
  });

  it('rejects a family that no eval has', () => {
    const file = validFile();
    file.families['step-up'] = 'tuning';
    expectConfigError(() => validateSplitFile(file, EVALS, FILE), 'unknown family', 'step-up', FILE);
  });

  it('rejects a label that is not tuning or heldout', () => {
    const file = validFile();
    (file.families as Record<string, string>).rbac = 'train';
    expectConfigError(() => validateSplitFile(file, EVALS, FILE), 'rbac', 'train', FILE);
  });

  it('rejects a pair naming an unlisted family', () => {
    const file = validFile();
    file.pairs.push(['rbac', 'dpop']);
    expectConfigError(() => validateSplitFile(file, EVALS, FILE), 'dpop', FILE);
  });

  it('rejects a pair with both sides on the same split', () => {
    const file = validFile();
    file.pairs = [['mfa', 'rbac']];
    expectConfigError(() => validateSplitFile(file, EVALS, FILE), 'mfa', 'rbac', FILE);
  });

  it('rejects a family that appears in two pairs', () => {
    const file = validFile();
    file.pairs.push(['rbac', 'passkeys']);
    expectConfigError(() => validateSplitFile(file, EVALS, FILE), 'passkeys', 'more than one pair', FILE);
  });

  it('rejects a held-out family with fewer than 3 evals', () => {
    const file = validFile();
    file.families.rbac = 'heldout';
    file.history = [{ date: '2026-11-26', heldout: ['passkeys', 'rbac'] }];
    expectConfigError(() => validateSplitFile(file, EVALS, FILE), 'rbac', 'at least 3', FILE);
  });

  it('rejects history that does not match the current held-out families', () => {
    const file = validFile();
    file.history = [{ date: '2026-11-26', heldout: ['mfa'] }];
    expectConfigError(() => validateSplitFile(file, EVALS, FILE), 'history', 'passkeys', FILE);
  });

  it('rejects empty history', () => {
    const file = validFile();
    file.history = [];
    expectConfigError(() => validateSplitFile(file, EVALS, FILE), 'history', FILE);
  });

  it('rejects a history date that is not YYYY-MM-DD', () => {
    const file = validFile();
    file.history = [{ date: '26/11/2026', heldout: ['passkeys'] }];
    expectConfigError(() => validateSplitFile(file, EVALS, FILE), '26/11/2026', FILE);
  });
});

describe('loadSplitFile', () => {
  it('reads a valid file', () => {
    const dir = createTmpDir();
    const path = join(dir, 'eval-splits.json');
    writeFileSync(path, JSON.stringify(validFile()));
    expect(loadSplitFile(path)).toEqual(validFile());
  });

  it('throws for a missing file', () => {
    const dir = createTmpDir();
    expectConfigError(() => loadSplitFile(join(dir, 'nope.json')), 'nope.json');
  });

  it('throws for invalid JSON', () => {
    const dir = createTmpDir();
    const path = join(dir, 'eval-splits.json');
    writeFileSync(path, '{ not json');
    expectConfigError(() => loadSplitFile(path), 'eval-splits.json');
  });

  it('throws for a file with the wrong shape', () => {
    const dir = createTmpDir();
    const path = join(dir, 'eval-splits.json');
    writeFileSync(path, JSON.stringify({ families: [] }));
    expectConfigError(() => loadSplitFile(path), 'eval-splits.json');
  });
});

describe('loadSplitsForEvals', () => {
  it('returns the evals unchanged when no split file is configured', () => {
    const result = loadSplitsForEvals(EVALS, '/repo', '');
    expect(result).toBe(EVALS);
    expect(result.every((e) => e.split === undefined)).toBe(true);
  });

  it('loads, validates and applies a configured file', () => {
    const dir = createTmpDir();
    writeFileSync(join(dir, 'eval-splits.json'), JSON.stringify(validFile()));
    const result = loadSplitsForEvals(EVALS, dir, 'eval-splits.json');
    expect(result.find((e) => e.category === 'passkeys')?.split).toBe('heldout');
  });

  it('throws when the configured file fails validation', () => {
    const dir = createTmpDir();
    const file = validFile();
    delete file.families.rbac;
    writeFileSync(join(dir, 'eval-splits.json'), JSON.stringify(file));
    expectConfigError(() => loadSplitsForEvals(EVALS, dir, 'eval-splits.json'), 'rbac');
  });
});
