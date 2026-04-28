/**
 * Tests for agent_eval/skills/strategy.ts — augmentWithSkills() and copySkillsToWorkspace()
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
  copyFileSync: vi.fn(),
}));
vi.mock('../src/agent_eval/skills/config.js', () => ({
  SKILLS_REMOTE_DIR: '/tmp/skills-remote',
  SKILLS_CLONE_DIR: '/tmp/skills-remote/auth0-skills',
  resolveSkillDir: vi.fn(),
}));
vi.mock('@a0/eval', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@a0/eval')>();
  return { ...actual, collectFiles: vi.fn() };
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEvalDef(overrides: Partial<EvalDefinition> = {}): EvalDefinition {
  return {
    id: 'test',
    name: 'Test Eval',
    category: 'quickstarts',
    path: '/tmp/test',
    baselineSystemPrompt: '',
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
  const mod = await import('../src/agent_eval/skills/strategy.js');
  return mod.augmentWithSkills;
}

async function importCopySkills() {
  const mod = await import('../src/agent_eval/skills/strategy.js');
  return mod.copySkillsToWorkspace;
}

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  // Reset mocked fs functions to defaults (existsSync=true simulates a cloned repo)
  const fs = vi.mocked(await import('node:fs'));
  fs.existsSync.mockReturnValue(true);
  fs.copyFileSync.mockReset();
  fs.mkdirSync.mockReset();
  const cp = vi.mocked(await import('node:child_process'));
  vi.mocked(cp.execFileSync as (...args: unknown[]) => unknown).mockReset();
  // Default: resolveSkillDir returns a valid path, collectFiles returns two files
  const skillsConfig = vi.mocked(await import('../src/agent_eval/skills/config.js'));
  vi.mocked(skillsConfig.resolveSkillDir).mockReturnValue('/tmp/skills-remote/auth0-skills/auth0-react');
  const evalPkg = vi.mocked(await import('@a0/eval'));
  vi.mocked(evalPkg.collectFiles).mockReturnValue(['README.md', 'SKILL.md']);
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

// ── copySkillsToWorkspace ─────────────────────────────────────────────────────

describe('copySkillsToWorkspace - no skills', () => {
  it('returns original evalDef unchanged when skills list is empty', async () => {
    const copySkillsToWorkspace = await importCopySkills();
    const evalDef = makeEvalDef({ skills: [] });

    const result = await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    expect(result).toBe(evalDef);
  });
});

describe('copySkillsToWorkspace - file copying', () => {
  it('calls copyFileSync for each file returned by collectFiles', async () => {
    const copySkillsToWorkspace = await importCopySkills();
    const fs = vi.mocked(await import('node:fs'));
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    expect(fs.copyFileSync).toHaveBeenCalledTimes(2); // README.md and SKILL.md
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('README.md'),
      expect.stringContaining('.claude/skills/auth0-react/README.md'),
    );
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      expect.stringContaining('.claude/skills/auth0-react/SKILL.md'),
    );
  });

  it('creates destination directories for each file', async () => {
    const copySkillsToWorkspace = await importCopySkills();
    const fs = vi.mocked(await import('node:fs'));
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.claude/skills'),
      expect.objectContaining({ recursive: true }),
    );
  });

  it('copies files from multiple skills', async () => {
    const copySkillsToWorkspace = await importCopySkills();
    const fs = vi.mocked(await import('node:fs'));
    const skillsConfig = vi.mocked(await import('../src/agent_eval/skills/config.js'));
    vi.mocked(skillsConfig.resolveSkillDir)
      .mockReturnValueOnce('/tmp/skills/auth0-react')
      .mockReturnValueOnce('/tmp/skills/auth0-nextjs');
    const evalDef = makeEvalDef({ skills: ['auth0-react', 'auth0-nextjs'] });

    await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    // 2 files per skill × 2 skills = 4 copyFileSync calls
    expect(fs.copyFileSync).toHaveBeenCalledTimes(4);
  });
});

describe('copySkillsToWorkspace - no prompt augmentation', () => {
  it('does not modify agentSystemPrompt (Claude Code auto-loads .claude/skills/)', async () => {
    const copySkillsToWorkspace = await importCopySkills();
    const evalDef = makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: 'Original.' });

    const result = await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    expect(result.agentSystemPrompt).toBe('Original.');
  });

  it('returns the same evalDef object (no prompt changes needed)', async () => {
    const copySkillsToWorkspace = await importCopySkills();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    expect(result).toBe(evalDef);
  });
});

describe('copySkillsToWorkspace - skill not found', () => {
  it('throws when resolveSkillDir returns null for a skill', async () => {
    const copySkillsToWorkspace = await importCopySkills();
    const skillsConfig = vi.mocked(await import('../src/agent_eval/skills/config.js'));
    vi.mocked(skillsConfig.resolveSkillDir).mockReturnValue(null);
    const evalDef = makeEvalDef({ skills: ['unknown-skill'] });

    await expect(copySkillsToWorkspace(evalDef, '/tmp/workspace')).rejects.toThrow("Skill 'unknown-skill' not found");
  });
});
