import { join, resolve } from 'node:path';

export const SKILLS_REMOTE_DIR = resolve(process.env.SKILLS_REMOTE_DIR ?? 'skills-remote');
export const SKILLS_CLONE_DIR = join(SKILLS_REMOTE_DIR, 'auth0-skills');
export const SKILLS_BASE_DIR = join(SKILLS_CLONE_DIR, 'plugins/auth0-sdks/skills');
