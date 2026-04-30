import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveInside } from '../../workspace/index.js';
import { getFrameworkConfig } from '../../config/framework-config.js';

function getSkillsCloneDir(): string {
  const config = getFrameworkConfig();
  const firstRepo = config.skills.remoteRepos?.[0];
  return resolve(process.env.SKILLS_REMOTE_DIR ?? firstRepo?.localPath ?? 'skills-remote');
}

function getSkillsBaseDir(): string {
  const config = getFrameworkConfig();
  const firstRepo = config.skills.remoteRepos?.[0];
  const skillsPath = firstRepo?.skillsPath ?? '.';
  return join(getSkillsCloneDir(), skillsPath);
}

function getSkillsLocalDir(): string {
  const config = getFrameworkConfig();
  const firstLocalDir = config.skills.localDirs?.[0];
  return resolve(process.env.SKILLS_LOCAL_DIR ?? firstLocalDir ?? 'skills');
}

export function getSkillsDirs() {
  return {
    SKILLS_CLONE_DIR: getSkillsCloneDir(),
    SKILLS_BASE_DIR: getSkillsBaseDir(),
    SKILLS_LOCAL_DIR: getSkillsLocalDir(),
  };
}

/**
 * Resolve the directory for a given skill name, checking remote then local.
 * Throws if the skill name is a path traversal attempt.
 * Returns null if the skill is not found in any base.
 */
export function resolveSkillDir(skill: string): string | null {
  const { SKILLS_BASE_DIR, SKILLS_LOCAL_DIR } = getSkillsDirs();
  for (const base of [SKILLS_BASE_DIR, SKILLS_LOCAL_DIR]) {
    const dir = resolveInside(base, skill); // throws on traversal
    if (existsSync(dir)) return dir;
  }
  return null;
}
