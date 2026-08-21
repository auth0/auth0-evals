/**
 * Collects skill documentation content from resolved skill directories.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** One markdown file belonging to a skill. */
export interface SkillFile {
  /** Skill name the file belongs to. */
  skill: string;
  /** Path relative to the skill directory, e.g. `references/feature-mfa/index.md`. */
  relPath: string;
  content: string;
}

/**
 * Recursively yields `.md` paths under `dir`, relative to `base`. Sorted at every
 * level so the collected order is stable across machines.
 */
function* walkMarkdown(dir: string, base: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdown(full, base);
    } else if (entry.name.endsWith('.md')) {
      yield full.slice(base.length + 1);
    }
  }
}

/**
 * Reads a skill's markdown files: `SKILL.md` plus every `.md` under `references/`.
 *
 * The walk is recursive because a reference is not necessarily a single file — the
 * auth0 skill stores each one as a directory (`references/feature-mfa/index.md`,
 * plus leaf documents beside it). A flat `readdir` for `*.md` sees only directory
 * names, matches nothing, and hands the analyst the router with no reference pool
 * behind it, which reads as "the skill documents none of this".
 *
 * @param skillDirs - Map of skill name → resolved directory path (null entries are skipped).
 */
export function collectSkillFiles(skillDirs: Record<string, string | null>): SkillFile[] {
  const files: SkillFile[] = [];

  for (const [skill, dir] of Object.entries(skillDirs)) {
    if (!dir) continue;

    const skillMd = join(dir, 'SKILL.md');
    if (existsSync(skillMd)) {
      files.push({ skill, relPath: 'SKILL.md', content: readFileSync(skillMd, 'utf-8') });
    }

    const refsDir = join(dir, 'references');
    if (!existsSync(refsDir)) continue;
    for (const relPath of walkMarkdown(refsDir, dir)) {
      try {
        files.push({ skill, relPath, content: readFileSync(join(dir, relPath), 'utf-8') });
      } catch {
        // skip unreadable
      }
    }
  }

  return files;
}

/**
 * Flat concatenation of a skill set's markdown, for callers that just want one
 * blob. Prefer `collectSkillFiles` when the content has to be prioritised or
 * budgeted per file.
 */
export function collectSkillContent(skillDirs: Record<string, string | null>): string {
  return collectSkillFiles(skillDirs)
    .map((f) =>
      f.relPath === 'SKILL.md' ? `## Skill: ${f.skill}\n${f.content}` : `### ${f.skill}/${f.relPath}\n${f.content}`,
    )
    .join('\n\n');
}
