/**
 * Skills delivery for agent runs.
 *
 * Contains the SkillsStrategy interface and concrete implementations:
 *
 *   - CopySkillsStrategy  (filesystem-native agents: Claude Code, Copilot, Gemini, etc.)
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import type { EvalDefinition } from '../../types/eval.js';
import { collectFiles } from '../../workspace/index.js';
import { logger } from '../../utils/logger.js';
import { getSkillsManager } from './config.js';

// ── Clone / pull (runs once per process) ─────────────────────────────────────

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Copies skill files into `<skillsDir>/<skill>/` in the workspace.
 * @param skillsDir — dot-directory path relative to the workspace (e.g. `.claude/skills`).
 */
export async function copySkillsToWorkspace(
  evalDef: EvalDefinition,
  workspace: string,
  skillsDir = '.claude/skills',
): Promise<EvalDefinition> {
  if (!evalDef.skills.length) {
    return evalDef;
  }

  const manager = getSkillsManager();
  const cloned = await manager.ensureAllCloned();
  if (!cloned) {
    logger.warn('[skills] Remote clone/pull failed — skills may resolve from stale or missing checkouts');
  }

  for (const skill of evalDef.skills) {
    const skillDir = manager.resolveSkillDir(skill);
    if (!skillDir) {
      const searchPaths = manager.getSearchPaths();
      const locations = searchPaths.length ? searchPaths.join(', ') : '(no skill directories configured)';
      throw new Error(`Skill '${skill}' not found in any configured directory: ${locations}`);
    }
    const files = collectFiles(skillDir, skillDir, { maxFiles: Infinity });
    for (const relPath of files) {
      const dest = join(workspace, skillsDir, skill, relPath);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(skillDir, relPath), dest);
    }
    logger.info(`  [skills] Copied ${files.length} file(s) for '${skill}' → ${skillsDir}/${skill}/`);
  }

  return evalDef;
}

// ── SkillsStrategy Interface ──────────────────────────────────────────────────

/**
 * SkillsStrategy interface.
 *
 * Skills can be delivered to an agent in different ways depending on how that
 * agent accesses external context:
 *
 *   - CopySkillsStrategy  (filesystem-native agents such as Claude Code, Copilot, Gemini)
 *       Copies skill files into the workspace under a configurable directory.
 *       Auto-discovered by some CLIs (Claude Code, Gemini); explicitly configured
 *       in the runner for others (Copilot).
 *
 * When adding a new agent, pick the strategy that matches how it reads context.
 */
export interface SkillsStrategy {
  apply(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition>;
}

// ── CopySkillsStrategy ────────────────────────────────────────────────────────

/**
 * Delivers skills by copying files into a configurable directory in the workspace.
 * Some CLIs auto-discover specific directories (e.g. `.claude/skills/` for Claude Code,
 * `.gemini/skills/` for Gemini), while others require explicit configuration in the
 * runner (e.g. Copilot reads `.github/skills/` only because `skillDirectories` is set
 * in `runners/copilot/agent.ts`).
 */
export class CopySkillsStrategy implements SkillsStrategy {
  constructor(private readonly skillsDir: string) {}

  async apply(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    return copySkillsToWorkspace(evalDef, workspace, this.skillsDir);
  }
}
