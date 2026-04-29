/**
 * Unit tests for InjectSkillsStrategy and CopySkillsStrategy.
 *
 * Tests observable output of strategy.apply() by mocking at the
 * filesystem / config level (same approach as skills.test.ts).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { EvalDefinition } from '../src/runners/loader.js';
import './setup-config.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  copyFileSync: vi.fn(),
}));
vi.mock('../src/agent_eval/skills/config.js', () => ({
  getSkillsDirs: vi.fn().mockReturnValue({
    SKILLS_CLONE_DIR: '/tmp/skills-remote/auth0-skills',
    SKILLS_BASE_DIR: '/tmp/skills-remote/auth0-skills/plugins/auth0/skills',
    SKILLS_LOCAL_DIR: '/tmp/skills',
  }),
  resolveSkillDir: vi.fn().mockReturnValue('/tmp/skills-remote/auth0-skills/plugins/auth0/skills/auth0-react'),
}));
vi.mock('@a0/eval', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@a0/eval')>();
  return { ...actual, collectFiles: vi.fn().mockReturnValue(['SKILL.md']) };
});

// Import after mocks are set up
const { InjectSkillsStrategy, CopySkillsStrategy } = await import('../src/agent_eval/skills/strategy.js');

function makeEvalDef(overrides: Partial<EvalDefinition> = {}): EvalDefinition {
  return {
    id: 'test',
    name: 'Test Eval',
    category: 'quickstarts',
    path: '/tmp/test',
    systemPrompt: '',
    userPrompt: 'Add authentication.',
    agentSystemPrompt: 'Original prompt.',
    graders: [],
    scaffold: {},
    skills: ['auth0-react'],
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('InjectSkillsStrategy', () => {
  it('injects skills notice into agentSystemPrompt', async () => {
    const strategy = new InjectSkillsStrategy();
    const result = await strategy.apply(makeEvalDef(), '/tmp/workspace');
    expect(result.agentSystemPrompt).toContain('auth0-react');
    expect(result.agentSystemPrompt).toContain('list_skill_files');
  });

  it('preserves the original system prompt', async () => {
    const strategy = new InjectSkillsStrategy();
    const result = await strategy.apply(makeEvalDef({ agentSystemPrompt: 'Original.' }), '/tmp/workspace');
    expect(result.agentSystemPrompt).toContain('Original.');
  });

  it('returns evalDef unchanged when no skills are defined', async () => {
    const evalDef = makeEvalDef({ skills: [] });
    const strategy = new InjectSkillsStrategy();
    const result = await strategy.apply(evalDef, '/tmp/workspace');
    expect(result).toBe(evalDef);
  });
});

describe('CopySkillsStrategy', () => {
  it('does not modify agentSystemPrompt', async () => {
    const strategy = new CopySkillsStrategy('.claude/skills');
    const result = await strategy.apply(makeEvalDef(), '/tmp/workspace');
    expect(result.agentSystemPrompt).toBe('Original prompt.');
  });

  it('copies skill files to the configured directory in the workspace', async () => {
    const fs = vi.mocked(await import('node:fs'));
    const strategy = new CopySkillsStrategy('.claude/skills');
    await strategy.apply(makeEvalDef(), '/tmp/workspace');
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      expect.stringContaining('.claude/skills/auth0-react/SKILL.md'),
    );
  });

  it('respects a custom skills directory', async () => {
    const fs = vi.mocked(await import('node:fs'));
    const strategy = new CopySkillsStrategy('.gemini/skills');
    await strategy.apply(makeEvalDef(), '/tmp/workspace');
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      expect.stringContaining('.gemini/skills/auth0-react/SKILL.md'),
    );
  });
});
