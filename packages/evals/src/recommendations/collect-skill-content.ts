/**
 * Collects and concatenates skill documentation content from resolved skill directories.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads and concatenates skill file contents (SKILL.md + references/) for a list of
 * resolved skill directories. Returns empty string if no directories provided or found.
 *
 * @param skillDirs - Map of skill name → resolved directory path (null entries are skipped).
 */
export function collectSkillContent(skillDirs: Record<string, string | null>): string {
  const parts: string[] = [];

  for (const [skill, dir] of Object.entries(skillDirs)) {
    if (!dir) continue;

    const skillMd = join(dir, 'SKILL.md');
    if (existsSync(skillMd)) {
      parts.push(`## Skill: ${skill}\n${readFileSync(skillMd, 'utf-8')}`);
    }

    const refsDir = join(dir, 'references');
    if (existsSync(refsDir)) {
      for (const file of readdirSync(refsDir)) {
        if (file.endsWith('.md')) {
          parts.push(`### ${skill}/references/${file}\n${readFileSync(join(refsDir, file), 'utf-8')}`);
        }
      }
    }
  }

  return parts.join('\n\n');
}
