/**
 * Unit tests for skills strategy: augmentWithSkills(), copySkillsToWorkspace(),
 * InjectSkillsStrategy, CopySkillsStrategy, and SkillsManager.
 *
 * vi.resetModules() is called before each test so the module-level
 * SkillsManager singleton is recreated, giving each test a clean slate.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EvalDefinition } from '../src/types/eval.js';

// Must mock framework-config so the singleton survives re-imports.
vi.mock('../src/config/framework-config.js', () => ({
  getFrameworkConfig: vi.fn().mockReturnValue({
    evalsDir: 'src/evals',
    proxy: { baseUrl: 'https://llm.atko.ai/v1' },
    mcp: { servers: { 'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' } } },
    skills: {
      remoteRepos: [
        {
          url: 'https://github.com/auth0/agent-skills.git',
          localPath: 'skills-remote/auth0-skills',
          skillsPath: 'plugins/auth0/skills',
        },
      ],
      localDirs: ['skills'],
    },
    judge: { model: 'claude-sonnet-4-5', maxTokens: 1024, maxCodeChars: 16384, promptsDir: 'src/prompts/judge' },
    models: { known: [], default: 'gpt-5.4', bedrock: {}, litellm: {} },
  }),
  setFrameworkConfig: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  copyFileSync: vi.fn(),
}));
vi.mock('../src/workspace/index.js', () => ({
  collectFiles: vi.fn(),
  resolveInside: vi.fn((base: string, rel: string) => (rel === '.' ? base : `${base}/${rel}`)),
}));

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

// Fresh module import per test to reset the module-level singleton
async function importStrategy() {
  return await import('../src/runners/skills/strategy.js');
}

async function importConfig() {
  return await import('../src/runners/skills/config.js');
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
  const workspace = vi.mocked(await import('../src/workspace/index.js'));
  vi.mocked(workspace.collectFiles).mockReturnValue(['README.md', 'SKILL.md']);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── SkillsManager ─────────────────────────────────────────────────────────────

describe('SkillsManager', () => {
  it('resolves skills from local dirs before remote repos', async () => {
    const fs = vi.mocked(await import('node:fs'));
    // Only the local dir path exists
    fs.existsSync.mockImplementation((p: unknown) => typeof p === 'string' && p.includes('/skills/my-skill'));
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: ['skills'],
      remoteRepos: [{ url: 'https://example.com/repo.git', localPath: 'remote', skillsPath: '.' }],
    });

    const result = manager.resolveSkillDir('my-skill');

    expect(result).toContain('/skills/my-skill');
    expect(result).not.toContain('remote');
  });

  it('falls back to remote repos when skill not in local dirs', async () => {
    const fs = vi.mocked(await import('node:fs'));
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: ['skills'],
      remoteRepos: [{ url: 'https://example.com/repo.git', localPath: 'remote', skillsPath: 'plugins' }],
    });

    // Only the remote path exists
    fs.existsSync.mockImplementation((p: unknown) => typeof p === 'string' && p.includes('remote/plugins/my-skill'));

    const result = manager.resolveSkillDir('my-skill');

    expect(result).toContain('remote/plugins/my-skill');
  });

  it('supports multiple local directories in order', async () => {
    const fs = vi.mocked(await import('node:fs'));
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: ['skills-a', 'skills-b'],
      remoteRepos: [],
    });

    // Only skills-b has the skill
    fs.existsSync.mockImplementation((p: unknown) => typeof p === 'string' && p.includes('skills-b/my-skill'));

    const result = manager.resolveSkillDir('my-skill');

    expect(result).toContain('skills-b/my-skill');
  });

  it('supports multiple remote repos in order', async () => {
    const fs = vi.mocked(await import('node:fs'));
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: [],
      remoteRepos: [
        { url: 'https://example.com/repo-a.git', localPath: 'remote-a', skillsPath: '.' },
        { url: 'https://example.com/repo-b.git', localPath: 'remote-b', skillsPath: '.' },
      ],
    });

    // Only remote-b has the skill
    fs.existsSync.mockImplementation((p: unknown) => typeof p === 'string' && p.includes('remote-b/my-skill'));

    const result = manager.resolveSkillDir('my-skill');

    expect(result).toContain('remote-b/my-skill');
  });

  it('returns null when skill not found in any location', async () => {
    const fs = vi.mocked(await import('node:fs'));
    fs.existsSync.mockReturnValue(false);
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: ['skills'],
      remoteRepos: [{ url: 'https://example.com/repo.git', localPath: 'remote', skillsPath: '.' }],
    });

    const result = manager.resolveSkillDir('nonexistent');

    expect(result).toBeNull();
  });

  it('getSearchPaths returns local dirs then remote bases in order', async () => {
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: ['skills-local-a', 'skills-local-b'],
      remoteRepos: [{ url: 'https://example.com/repo.git', localPath: 'remote-x', skillsPath: 'plugins' }],
    });

    const paths = manager.getSearchPaths();

    expect(paths).toHaveLength(3);
    expect(paths[0]).toContain('skills-local-a');
    expect(paths[1]).toContain('skills-local-b');
    expect(paths[2]).toContain('remote-x');
    expect(paths[2]).toContain('plugins');
  });

  it('ensureAllCloned clones each remote repo', async () => {
    const cp = vi.mocked(await import('node:child_process'));
    const fs = vi.mocked(await import('node:fs'));
    // No existing .git dirs
    fs.existsSync.mockReturnValue(false);

    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: [],
      remoteRepos: [
        { url: 'https://example.com/repo-a.git', localPath: 'remote-a' },
        { url: 'https://example.com/repo-b.git', localPath: 'remote-b' },
      ],
    });

    await manager.ensureAllCloned();

    // Two clone calls
    expect(cp.execFileSync).toHaveBeenCalledTimes(2);
    expect(cp.execFileSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['clone', '--depth', '1', 'https://example.com/repo-a.git']),
      expect.anything(),
    );
    expect(cp.execFileSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['clone', '--depth', '1', 'https://example.com/repo-b.git']),
      expect.anything(),
    );
  });

  it('ensureAllCloned fetches and resets when .git already exists', async () => {
    const cp = vi.mocked(await import('node:child_process'));
    const fs = vi.mocked(await import('node:fs'));
    fs.existsSync.mockReturnValue(true); // .git dir exists

    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: [],
      remoteRepos: [{ url: 'https://example.com/repo.git', localPath: 'remote' }],
    });

    await manager.ensureAllCloned();

    expect(cp.execFileSync).toHaveBeenCalledWith('git', ['fetch', '--depth', '1', 'origin'], expect.anything());
    expect(cp.execFileSync).toHaveBeenCalledWith('git', ['reset', '--hard', 'FETCH_HEAD'], expect.anything());
  });

  it('gracefully handles zero remote repos', async () => {
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: ['skills'],
      remoteRepos: [],
    });

    // Should not throw
    await manager.ensureAllCloned();
  });

  it('retries clone on failure', async () => {
    const cp = vi.mocked(await import('node:child_process'));
    const fs = vi.mocked(await import('node:fs'));
    fs.existsSync.mockReturnValue(false);
    const execMock = vi.mocked(cp.execFileSync as (...args: unknown[]) => unknown);
    execMock.mockImplementationOnce(() => {
      throw new Error('network error');
    });

    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: [],
      remoteRepos: [{ url: 'https://example.com/repo.git', localPath: 'remote' }],
    });

    await manager.ensureAllCloned(); // fails
    execMock.mockImplementation(() => {}); // succeeds on retry
    await manager.ensureAllCloned(); // retries

    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('ensureAllCloned returns true when no remote repos configured', async () => {
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({ localDirs: ['skills'], remoteRepos: [] });

    const result = await manager.ensureAllCloned();

    expect(result).toBe(true);
  });

  it('rejects URLs with disallowed schemes', async () => {
    const cp = vi.mocked(await import('node:child_process'));
    const fs = vi.mocked(await import('node:fs'));
    fs.existsSync.mockReturnValue(false);

    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: [],
      remoteRepos: [{ url: 'git://example.com/repo.git', localPath: 'remote-git' }],
    });

    const result = await manager.ensureAllCloned();

    expect(result).toBe(false);
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it('accepts https://, ssh://, and git@ URL schemes', async () => {
    const cp = vi.mocked(await import('node:child_process'));
    const fs = vi.mocked(await import('node:fs'));
    fs.existsSync.mockReturnValue(false);

    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: [],
      remoteRepos: [
        { url: 'https://github.com/org/repo.git', localPath: 'remote-https' },
        { url: 'ssh://git@github.com/org/repo2.git', localPath: 'remote-ssh' },
        { url: 'git@github.com:org/repo3.git', localPath: 'remote-scp' },
      ],
    });

    await manager.ensureAllCloned();

    // All three should attempt a clone
    expect(cp.execFileSync).toHaveBeenCalledTimes(3);
  });

  it('returns available=true with stale clone when fetch fails on existing checkout', async () => {
    const cp = vi.mocked(await import('node:child_process'));
    const fs = vi.mocked(await import('node:fs'));
    // .git exists (existing clone)
    fs.existsSync.mockReturnValue(true);
    // fetch fails
    vi.mocked(cp.execFileSync as (...args: unknown[]) => unknown).mockImplementation(() => {
      throw new Error('network timeout');
    });

    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: [],
      remoteRepos: [{ url: 'https://example.com/repo.git', localPath: 'remote' }],
    });

    const result = await manager.ensureAllCloned();

    // Stale clone is still usable
    expect(result).toBe(true);
  });

  it('allows retry after stale fallback (promise not cached)', async () => {
    const cp = vi.mocked(await import('node:child_process'));
    const fs = vi.mocked(await import('node:fs'));
    fs.existsSync.mockReturnValue(true); // .git exists
    const execMock = vi.mocked(cp.execFileSync as (...args: unknown[]) => unknown);
    // First call: fetch fails (stale fallback)
    execMock.mockImplementationOnce(() => {
      throw new Error('network timeout');
    });

    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({
      localDirs: [],
      remoteRepos: [{ url: 'https://example.com/repo.git', localPath: 'remote' }],
    });

    await manager.ensureAllCloned(); // stale fallback (fetch throws, 1 call)
    // Second call should retry (promise was cleared)
    execMock.mockImplementation(() => {});
    await manager.ensureAllCloned(); // fetch + reset succeed (2 calls)

    // Total: 1 (failed fetch) + 2 (successful fetch + reset) = 3
    expect(execMock).toHaveBeenCalledTimes(3);
  });

  it('getRepoCloneDir derives unique slug from HTTPS URL', async () => {
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({ localDirs: [], remoteRepos: [] });

    const dir = manager.getRepoCloneDir({ url: 'https://github.com/auth0/agent-skills.git' });

    expect(dir).toContain('skills-remote/auth0-agent-skills');
  });

  it('getRepoCloneDir derives unique slug from SSH scp-style URL', async () => {
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({ localDirs: [], remoteRepos: [] });

    const dir = manager.getRepoCloneDir({ url: 'git@github.com:org/my-repo.git' });

    expect(dir).toContain('skills-remote/org-my-repo');
  });

  it('getRepoCloneDir derives unique slug from ssh:// URL', async () => {
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({ localDirs: [], remoteRepos: [] });

    const dir = manager.getRepoCloneDir({ url: 'ssh://git@github.com/org/my-repo.git' });

    expect(dir).toContain('skills-remote/org-my-repo');
  });

  it('getRepoCloneDir uses explicit localPath when provided', async () => {
    const { SkillsManager } = await importConfig();
    const manager = new SkillsManager({ localDirs: [], remoteRepos: [] });

    const dir = manager.getRepoCloneDir({
      url: 'https://github.com/org/repo.git',
      localPath: 'my-custom-path/repo',
    });

    expect(dir).toContain('my-custom-path/repo');
    expect(dir).not.toContain('skills-remote');
  });

  it('rejects clone dir with fewer than 3 path segments', async () => {
    const cp = vi.mocked(await import('node:child_process'));
    const fs = vi.mocked(await import('node:fs'));
    fs.existsSync.mockReturnValue(false);

    const { SkillsManager } = await importConfig();
    // localPath resolves to something short like /tmp (< 3 segments)
    const manager = new SkillsManager({
      localDirs: [],
      remoteRepos: [{ url: 'https://example.com/repo.git', localPath: '/ab' }],
    });

    const result = await manager.ensureAllCloned();

    expect(result).toBe(false);
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });
});

// ── augmentWithSkills ─────────────────────────────────────────────────────────

describe('augmentWithSkills - no skills', () => {
  it('returns original evalDef unchanged when skills list is empty', async () => {
    const { augmentWithSkills } = await importStrategy();
    const evalDef = makeEvalDef({ skills: [] });

    const result = await augmentWithSkills(evalDef);

    expect(result).toBe(evalDef);
  });
});

describe('augmentWithSkills - notice injection', () => {
  it('prepends Available Skills section to agentSystemPrompt', async () => {
    const { augmentWithSkills } = await importStrategy();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('## Available Skills');
    expect(result.agentSystemPrompt).toContain('auth0-react');
  });

  it('mentions the list_skill_files tool', async () => {
    const { augmentWithSkills } = await importStrategy();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('list_skill_files');
  });

  it('mentions the read_skill_file tool', async () => {
    const { augmentWithSkills } = await importStrategy();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).toContain('read_skill_file');
  });

  it('appends existing agentSystemPrompt after a separator', async () => {
    const { augmentWithSkills } = await importStrategy();
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
    const { augmentWithSkills } = await importStrategy();
    const evalDef = makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: '' });

    const result = await augmentWithSkills(evalDef);

    expect(result.agentSystemPrompt).not.toContain('---');
  });

  it('does not mutate the original evalDef', async () => {
    const { augmentWithSkills } = await importStrategy();
    const evalDef = makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: 'Original.' });
    const originalPrompt = evalDef.agentSystemPrompt;

    await augmentWithSkills(evalDef);

    expect(evalDef.agentSystemPrompt).toBe(originalPrompt);
  });

  it('lists all skill names in the notice', async () => {
    const { augmentWithSkills } = await importStrategy();
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

    const { augmentWithSkills } = await importStrategy();
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

    const { augmentWithSkills } = await importStrategy();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    await augmentWithSkills(evalDef); // first call — clone fails
    await augmentWithSkills(evalDef); // second call — should retry

    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
  });

  it('removes corrupt directory and clones fresh when clone dir exists without .git', async () => {
    const fs = vi.mocked(await import('node:fs'));
    // existsSync(join(cloneDir, '.git')) → false, existsSync(cloneDir) → true
    fs.existsSync.mockImplementation(
      (p: unknown) => typeof p === 'string' && !p.endsWith('.git') && p.includes('auth0-skills'),
    );

    const { augmentWithSkills } = await importStrategy();
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
    const { copySkillsToWorkspace } = await importStrategy();
    const evalDef = makeEvalDef({ skills: [] });

    const result = await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    expect(result).toBe(evalDef);
  });
});

describe('copySkillsToWorkspace - file copying', () => {
  it('calls copyFileSync for each file returned by collectFiles', async () => {
    const { copySkillsToWorkspace } = await importStrategy();
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
    const { copySkillsToWorkspace } = await importStrategy();
    const fs = vi.mocked(await import('node:fs'));
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.claude/skills'),
      expect.objectContaining({ recursive: true }),
    );
  });

  it('copies files from multiple skills', async () => {
    const { copySkillsToWorkspace } = await importStrategy();
    const fs = vi.mocked(await import('node:fs'));
    const evalDef = makeEvalDef({ skills: ['auth0-react', 'auth0-nextjs'] });

    await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    // 2 files per skill × 2 skills = 4 copyFileSync calls
    expect(fs.copyFileSync).toHaveBeenCalledTimes(4);
  });
});

describe('copySkillsToWorkspace - no prompt augmentation', () => {
  it('does not modify agentSystemPrompt (Claude Code auto-loads .claude/skills/)', async () => {
    const { copySkillsToWorkspace } = await importStrategy();
    const evalDef = makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: 'Original.' });

    const result = await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    expect(result.agentSystemPrompt).toBe('Original.');
  });

  it('returns the same evalDef object (no prompt changes needed)', async () => {
    const { copySkillsToWorkspace } = await importStrategy();
    const evalDef = makeEvalDef({ skills: ['auth0-react'] });

    const result = await copySkillsToWorkspace(evalDef, '/tmp/workspace');

    expect(result).toBe(evalDef);
  });
});

describe('copySkillsToWorkspace - skill not found', () => {
  it('throws when skill is not found in any configured directory', async () => {
    const fs = vi.mocked(await import('node:fs'));
    // resolveSkillDir will check all paths — none exist
    fs.existsSync.mockReturnValue(false);
    const { copySkillsToWorkspace } = await importStrategy();
    const evalDef = makeEvalDef({ skills: ['unknown-skill'] });

    await expect(copySkillsToWorkspace(evalDef, '/tmp/workspace')).rejects.toThrow("Skill 'unknown-skill' not found");
  });
});

// ── Strategy classes ──────────────────────────────────────────────────────────

describe('InjectSkillsStrategy', () => {
  it('injects skills notice into agentSystemPrompt', async () => {
    const { InjectSkillsStrategy } = await importStrategy();
    const strategy = new InjectSkillsStrategy();
    const result = await strategy.apply(makeEvalDef({ skills: ['auth0-react'] }), '/tmp/workspace');
    expect(result.agentSystemPrompt).toContain('auth0-react');
    expect(result.agentSystemPrompt).toContain('list_skill_files');
  });

  it('preserves the original system prompt', async () => {
    const { InjectSkillsStrategy } = await importStrategy();
    const strategy = new InjectSkillsStrategy();
    const result = await strategy.apply(
      makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: 'Original.' }),
      '/tmp/workspace',
    );
    expect(result.agentSystemPrompt).toContain('Original.');
  });

  it('returns evalDef unchanged when no skills are defined', async () => {
    const { InjectSkillsStrategy } = await importStrategy();
    const evalDef = makeEvalDef({ skills: [] });
    const strategy = new InjectSkillsStrategy();
    const result = await strategy.apply(evalDef, '/tmp/workspace');
    expect(result).toBe(evalDef);
  });
});

describe('CopySkillsStrategy', () => {
  it('does not modify agentSystemPrompt', async () => {
    const { CopySkillsStrategy } = await importStrategy();
    const strategy = new CopySkillsStrategy('.claude/skills');
    const result = await strategy.apply(
      makeEvalDef({ skills: ['auth0-react'], agentSystemPrompt: 'Original prompt.' }),
      '/tmp/workspace',
    );
    expect(result.agentSystemPrompt).toBe('Original prompt.');
  });

  it('copies skill files to the configured directory in the workspace', async () => {
    const { CopySkillsStrategy } = await importStrategy();
    const fs = vi.mocked(await import('node:fs'));
    const strategy = new CopySkillsStrategy('.claude/skills');
    await strategy.apply(makeEvalDef({ skills: ['auth0-react'] }), '/tmp/workspace');
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      expect.stringContaining('.claude/skills/auth0-react/SKILL.md'),
    );
  });

  it('respects a custom skills directory', async () => {
    const { CopySkillsStrategy } = await importStrategy();
    const fs = vi.mocked(await import('node:fs'));
    const strategy = new CopySkillsStrategy('.gemini/skills');
    await strategy.apply(makeEvalDef({ skills: ['auth0-react'] }), '/tmp/workspace');
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      expect.stringContaining('.gemini/skills/auth0-react/SKILL.md'),
    );
  });
});
