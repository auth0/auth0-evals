import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalDefinition } from '@a0/evals-core';
import { makeTmpDir } from './tmp.js';

const skillDirs: Record<string, string | null> = {};
const resolveSkillDir = vi.fn((skill: string) => skillDirs[skill] ?? null);

vi.mock('@a0/evals-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@a0/evals-core')>()),
  getSkillsManager: () => ({ resolveSkillDir }),
}));

const { resolveSkillFiles } = await import('../src/recommendations/run-helper.js');

const tmp = makeTmpDir('skill_files_');

function evalWithSkills(skills: string[]): EvalDefinition {
  return { id: 'e', skills } as unknown as EvalDefinition;
}

beforeEach(() => {
  for (const k of Object.keys(skillDirs)) delete skillDirs[k];
  resolveSkillDir.mockClear();
});

describe('resolveSkillFiles', () => {
  it('returns undefined without touching the skills manager when skills were not in context', () => {
    expect(resolveSkillFiles(evalWithSkills(['auth0']), ['mcp'])).toBeUndefined();
    expect(resolveSkillDir).not.toHaveBeenCalled();
  });

  it("collects SKILL.md and references for each of the eval's skills", () => {
    const dir = tmp();
    mkdirSync(join(dir, 'references'), { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '# Auth0');
    writeFileSync(join(dir, 'references', 'react.md'), 'react notes');
    skillDirs.auth0 = dir;

    const files = resolveSkillFiles(evalWithSkills(['auth0', 'missing']), ['skills']);
    expect(files).toEqual([
      { skill: 'auth0', relPath: 'SKILL.md', content: '# Auth0' },
      { skill: 'auth0', relPath: 'references/react.md', content: 'react notes' },
    ]);
    expect(resolveSkillDir).toHaveBeenCalledWith('missing');
  });

  it('returns an empty list when the skills are not found', () => {
    expect(resolveSkillFiles(evalWithSkills(['missing']), ['skills'])).toEqual([]);
  });
});
