import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadManifests, collectRefProblems } from '../../src/mock/manifest.js';

const MOCKS = fileURLToPath(new URL('../../../apps/auth0-evals/mocks/', import.meta.url));

describe('app mock manifests', () => {
  it('all manifests load and validate', () => {
    expect(() => loadManifests([MOCKS])).not.toThrow();
  });
  it('every fixture/handler reference resolves', () => {
    // On plumbing, there are no *.routes.json manifests yet (guardian/token-exchange land on feature branches).
    // loadManifests([MOCKS]) returns [], and collectRefProblems([]) returns [] — vacuously true.
    // Real coverage arrives when manifests are added via Tasks 7–8.
    const problems = collectRefProblems(loadManifests([MOCKS]));
    expect(problems).toEqual([]);
  });
});
