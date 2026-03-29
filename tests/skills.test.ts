/**
 * Tests for runners/skills.ts — augmentWithSkills()
 *
 * vi.resetModules() is called before each test so the module-level cloneReady
 * promise starts fresh, giving each test a clean slate.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EvalDefinition } from '../src/runners/loader.js';

// Top-level mocks — hoisted by Vitest before any imports
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
}));

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

// Fresh module import per test to reset the module-level cloneReady promise
async function importAugment() {
  const mod = await import('../src/runners/skills.js');
  return mod.augmentWithSkills;
}

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  // Reset mocked fs functions to defaults (existsSync=true simulates a cloned repo)
  const fs = vi.mocked(await import('node:fs'));
  fs.existsSync.mockReturnValue(true);
  const cp = vi.mocked(await import('node:child_process'));
  vi.mocked(cp.execFileSync as (...args: unknown[]) => unknown).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── augmentWithSkills ─────────────────────────────────────────────────────────

describe('augmentWithSkills - no skills', () => {
  it('returns original evalDef unchanged when skills list is empty', async () => {
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: [] });

    const result = await augmentWithSkills(evalDef);

    expect(result).toBe(evalDef);
  });
});

describe('augmentWithSkills - notice injection', () => {
  it('prepends Available Skills section to agentSystemPrompt', async () => {
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('## Available Skills');
    expect(result.agentSystemPrompt).toContain('auth0-react');
  });

  it('mentions the list_skill_files tool', async () => {
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('list_skill_files');
  });

  it('mentions the read_skill_file tool', async () => {
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('read_skill_file');
  });

  it('appends existing agentSystemPrompt after a separator', async () => {
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: 'You are an expert.' });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('## Available Skills');
    expect(result.agentSystemPrompt).toContain('---');
    expect(result.agentSystemPrompt).toContain('You are an expert.');
    const skillIdx = result.agentSystemPrompt.indexOf('## Available Skills');
    const separatorIdx = result.agentSystemPrompt.indexOf('---');
    const promptIdx = result.agentSystemPrompt.indexOf('You are an expert.');
    expect(skillIdx).toBeLessThan(separatorIdx);
    expect(separatorIdx).toBeLessThan(promptIdx);
  });

  it('does not add separator when there is no existing agentSystemPrompt', async () => {
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: '' });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).not.toContain('---');
  });

  it('does not mutate the original evalDef', async () => {
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: 'Original.' });
    const originalPrompt = evalDef.agentSystemPrompt;

    await augmentWithSkills(evalDef);

    expect(evalDef.agentSystemPrompt).toBe(originalPrompt);
  });

  it('lists all skill names in the notice', async () => {
    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react', 'auth0-nextjs'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('auth0-react');
    expect(result.agentSystemPrompt).toContain('auth0-nextjs');
  });
});

describe('augmentWithSkills - clone failure', () => {
  it('still injects notice even when git clone/pull fails', async () => {
    const cp = vi.mocked(await import('node:child_process'));
    vi.mocked(cp.execFileSync as (...args: unknown[]) => unknown).mockImplementation(() => {
      throw new Error('git not found');
    });
    const fs = vi.mocked(await import('node:fs'));
    fs.existsSync.mockReturnValue(false);

    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    // Notice is still injected so the agent knows skills are expected
    expect(result.agentSystemPrompt).toContain('auth0-react');
    expect(result).not.toBe(evalDef);
  });

  it('resets cloneReady after failure so subsequent calls can retry', async () => {
    const cp = vi.mocked(await import('node:child_process'));
    const execFileSyncMock = vi.mocked(cp.execFileSync as (...args: unknown[]) => unknown);
    execFileSyncMock
      .mockImplementationOnce(() => {
        throw new Error('transient network error');
      })
      .mockImplementation(() => {}); // succeeds on retry
    const fs = vi.mocked(await import('node:fs'));
    fs.existsSync.mockReturnValue(false);

    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    await augmentWithSkills(evalDef); // first call — clone fails
    await augmentWithSkills(evalDef); // second call — should retry

    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
  });

  it('removes corrupt directory and clones fresh when SKILLS_CLONE_DIR exists without .git', async () => {
    const fs = vi.mocked(await import('node:fs'));
    // existsSync(join(SKILLS_CLONE_DIR, '.git')) → false, existsSync(SKILLS_CLONE_DIR) → true
    fs.existsSync.mockImplementation(
      (p: unknown) => typeof p === 'string' && !p.endsWith('.git') && p.includes('auth0-skills'),
    );

    const augmentWithSkills = await importAugment();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    await augmentWithSkills(evalDef);

    expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining('auth0-skills'), {
      recursive: true,
      force: true,
    });
    const cp = vi.mocked(await import('node:child_process'));
    expect(cp.execFileSync).toHaveBeenCalledWith('git', expect.arrayContaining(['clone']), expect.anything());
  });
});
