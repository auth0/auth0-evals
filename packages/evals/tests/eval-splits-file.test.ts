import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { discoverEvals, loadSplitFile, validateSplitFile } from '@a0/evals-core';

// Guards the checked-in split file against the real evals: a new family with no
// label, or a split that drifts from the agreed period, fails the build.
const APP_ROOT = fileURLToPath(new URL('../../../apps/auth0-evals/', import.meta.url));
const SPLITS_PATH = join(APP_ROOT, 'eval-splits.json');

describe('apps/auth0-evals/eval-splits.json', () => {
  const evals = discoverEvals('src/evals', APP_ROOT);
  const file = loadSplitFile(SPLITS_PATH);

  it('is valid for the discovered evals', () => {
    expect(() => validateSplitFile(file, evals, SPLITS_PATH)).not.toThrow();
  });

  it('holds out passkeys, enterprise-connect and token-vault', () => {
    const heldout = Object.entries(file.families)
      .filter(([, split]) => split === 'heldout')
      .map(([family]) => family)
      .sort();
    expect(heldout).toEqual(['enterprise-connect', 'passkeys', 'token-vault']);
  });

  it('holds out every eval in those families and no other', () => {
    const heldoutFamilies = new Set(['enterprise-connect', 'passkeys', 'token-vault']);
    const expected = evals.filter((e) => heldoutFamilies.has(e.category)).length;
    const actual = evals.filter((e) => file.families[e.category] === 'heldout').length;
    expect(expected).toBeGreaterThan(0);
    expect(actual).toBe(expected);
  });
});
