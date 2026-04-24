import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveInside } from '../path-utils.js';

export const SKILLS_REMOTE_DIR = resolve(process.env.SKILLS_REMOTE_DIR ?? 'skills-remote');
export const SKILLS_CLONE_DIR = join(SKILLS_REMOTE_DIR, 'auth0-skills');
export const SKILLS_BASE_DIR = join(SKILLS_CLONE_DIR, 'plugins/auth0/skills');
export const SKILLS_LOCAL_DIR = resolve(process.env.SKILLS_LOCAL_DIR ?? 'skills');

/**
 * Resolve the directory for a given skill name, checking remote then local.
 * Throws if the skill name is a path traversal attempt.
 * Returns null if the skill is not found in any base.
 */
export function resolveSkillDir(skill: string): string | null {
  for (const base of [SKILLS_BASE_DIR, SKILLS_LOCAL_DIR]) {
    const dir = resolveInside(base, skill); // throws on traversal
    if (existsSync(dir)) return dir;
  }
  return null;
}
