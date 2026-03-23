/**
 * Tests for runners/skills.ts — augmentWithSkills()
 *
 * vi.resetModules() is called before each test so the module-level skillCache
 * starts empty, giving each test a clean slate.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EvalDefinition } from '../runners/loader.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEvalDef(overrides: Partial<EvalDefinition> = {}): EvalDefinition {
  return {
    id: 'test',
    name: 'Test Eval',
    category: 'quickstarts',
    path: '/tmp/test',
    systemPrompt: '',
    userPrompt: 'Add authentication.',
    agentSystemPrompt: '',
    graders: [],
    scaffold: {},
    skills: [],
    metadata: {},
    ...overrides,
  };
}

function mockFetch(text: string, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status, text: async () => text }),
  );
}

function mockFetchError(error = new Error('network failure')) {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
}

// Fresh module import per test to reset the module-level skillCache
async function importAugment() {
  const mod = await import('../runners/skills.js');
  return mod.augmentWithSkills;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── augmentWithSkills ─────────────────────────────────────────────────────────

describe('augmentWithSkills - no skills', () => {
  it('returns original evalDef unchanged when skills list is empty', async () => {
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: [] });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await augmentWithSkills(evalDef);

    expect(result).toBe(evalDef);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('augmentWithSkills - success path', () => {
  it('prepends SDK Reference Material section to agentSystemPrompt', async () => {
    mockFetch('# Auth0 React SDK\nUse Auth0Provider.');
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('## SDK Reference Material');
    expect(result.agentSystemPrompt).toContain('Auth0 React SDK');
  });

  it('includes the skill name as a heading', async () => {
    mockFetch('Skill content here.');
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('### auth0-react');
  });

  it('appends existing agentSystemPrompt after a separator', async () => {
    mockFetch('Skill content.');
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: 'You are an expert.' });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('## SDK Reference Material');
    expect(result.agentSystemPrompt).toContain('---');
    expect(result.agentSystemPrompt).toContain('You are an expert.');
    const skillIdx = result.agentSystemPrompt.indexOf('## SDK Reference Material');
    const separatorIdx = result.agentSystemPrompt.indexOf('---');
    const promptIdx = result.agentSystemPrompt.indexOf('You are an expert.');
    expect(skillIdx).toBeLessThan(separatorIdx);
    expect(separatorIdx).toBeLessThan(promptIdx);
  });

  it('does not add separator when there is no existing agentSystemPrompt', async () => {
    mockFetch('Skill content.');
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: '' });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).not.toContain('---');
  });

  it('does not mutate the original evalDef', async () => {
    mockFetch('Skill content.');
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: 'Original.' });
    const originalPrompt = evalDef.agentSystemPrompt;

    await augmentWithSkills(evalDef);

    expect(evalDef.agentSystemPrompt).toBe(originalPrompt);
  });

  it('joins multiple skills with a separator', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        return { ok: true, status: 200, text: async () => `Content for skill ${callCount}` };
      }),
    );
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react', 'auth0-nextjs'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('### auth0-react');
    expect(result.agentSystemPrompt).toContain('### auth0-nextjs');
  });
});

describe('augmentWithSkills - cache hit', () => {
  it('fetches a skill only once across multiple augmentWithSkills calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'Cached skill content.',
    });
    vi.stubGlobal('fetch', fetchMock);
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    await augmentWithSkills(evalDef);
    await augmentWithSkills(evalDef);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('augmentWithSkills - failure paths', () => {
  it('returns original evalDef when fetch returns a non-ok response', async () => {
    mockFetch('Not Found', false, 404);
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result).toBe(evalDef);
  });

  it('returns original evalDef when fetch throws a network error', async () => {
    mockFetchError();
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result).toBe(evalDef);
  });

  it('returns original evalDef when fetch throws a timeout error', async () => {
    mockFetchError(new DOMException('The operation was aborted.', 'TimeoutError'));
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result).toBe(evalDef);
  });

  it('includes successful skills even when one skill fetch fails', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('network failure');
        return { ok: true, status: 200, text: async () => 'Good content.' };
      }),
    );
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['bad-skill', 'auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('auth0-react');
    expect(result.agentSystemPrompt).not.toContain('bad-skill');
  });
});
