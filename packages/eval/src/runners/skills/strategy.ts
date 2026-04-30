/**
 * Skills delivery for agent runs.
 *
 * Contains the SkillsStrategy interface and concrete implementations:
 *
 *   - InjectSkillsStrategy  (ReAct-style agents)
 *   - CopySkillsStrategy  (filesystem-native agents: Claude Code, Copilot, Gemini, etc.)
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

import { collectFiles } from '../../workspace/index.js';
import { logger } from '../../utils/logger.js';
import { getSkillsDirs, resolveSkillDir } from './config.js';
import { getFrameworkConfig } from '../../config/framework-config.js';
import type { EvalDefinition } from '../../types/eval.js';

// ── Clone / pull (runs once per process) ─────────────────────────────────────

let cloneReady: Promise<boolean> | undefined;

export function ensureCloned(): Promise<boolean> {
  if (!cloneReady) {
    cloneReady = doEnsureCloned().then((result) => {
      if (!result) cloneReady = undefined; // reset on failure so next call retries
      return result;
    });
  }
  return cloneReady;
}

async function doEnsureCloned(): Promise<boolean> {
  const { SKILLS_CLONE_DIR } = getSkillsDirs();
  const resolved = resolve(SKILLS_CLONE_DIR);
  if (!resolved || resolved === '/' || resolved === dirname(resolved)) {
    logger.error(`[skills] Refusing to operate on unsafe clone directory: "${SKILLS_CLONE_DIR}"`);
    return false;
  }
  const config = getFrameworkConfig();
  const remoteRepo = config.skills.remoteRepos?.[0];
  if (!remoteRepo?.url) {
    logger.warn('[skills] No remote skill repo configured — skipping clone');
    return false;
  }
  try {
    if (existsSync(join(resolved, '.git'))) {
      execFileSync('git', ['pull'], { cwd: resolved, stdio: 'pipe' });
    } else {
      if (existsSync(resolved)) {
        rmSync(resolved, { recursive: true, force: true });
      }
      mkdirSync(dirname(resolved), { recursive: true });
      execFileSync('git', ['clone', '--depth', '1', remoteRepo.url, resolved], { stdio: 'pipe' });
    }
    return true;
  } catch (e) {
    logger.error('[skills] failed to clone/pull —', e instanceof Error ? e.stack ?? e.message : String(e));
    return false;
  }
}

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
  const cloned = await ensureCloned();
  if (!cloned) {
    logger.warn('[skills] Remote clone unavailable — resolving skills from local directories only');
  }

  for (const skill of evalDef.skills) {
    const skillDir = resolveSkillDir(skill);
    if (!skillDir) {
      const { SKILLS_CLONE_DIR, SKILLS_LOCAL_DIR } = getSkillsDirs();
      throw new Error(
        `Skill '${skill}' not found in remote (${SKILLS_CLONE_DIR}) or local (${SKILLS_LOCAL_DIR}) directories`,
      );
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

export async function augmentWithSkills(evalDef: EvalDefinition): Promise<EvalDefinition> {
  if (!evalDef.skills.length) {
    return evalDef;
  }

  const cloned = await ensureCloned();
  if (!cloned) {
    logger.warn('[skills] Remote clone unavailable — resolving skills from local directories only');
  }

  const names = evalDef.skills.join(', ');
  const notice =
    `## Available Skills\n\n` +
    `The following Auth0 SDK skills are available: ${names}\n\n` +
    `Use \`list_skill_files\` to browse a skill's documentation files ` +
    `and \`read_skill_file\` to read specific files.\n\n` +
    `Always ensure you load the relevant skills before doing anything else, ` +
    `so you can use the documentation to help understand the approach to take.`;

  const parts = [notice];
  if (evalDef.agentSystemPrompt) parts.push(evalDef.agentSystemPrompt);
  return { ...evalDef, agentSystemPrompt: parts.join('\n\n---\n\n') };
}

// ── SkillsStrategy Interface ──────────────────────────────────────────────────

/**
 * SkillsStrategy interface.
 *
 * Skills can be delivered to an agent in different ways depending on how that
 * agent accesses external context:
 *
 *   - InjectSkillsStrategy  (ReAct-style agents)
 *       Prepends a skills notice and tool hints to evalDef.agentSystemPrompt.
 *       The agent accesses skills via the `list_skill_files` / `read_skill_file`
 *       custom tools.
 *
 *   - CopySkillsStrategy  (filesystem-native agents such as Claude Code, Copilot, Gemini)
 *       Copies skill files into the workspace under a configurable directory.
 *       Auto-discovered by some CLIs (Claude Code, Gemini); explicitly configured
 *       in the runner for others (Copilot).
 *
 * When adding a new agent, pick the strategy that matches how it reads context
 * — no need to re-implement the injection logic.
 */
export interface SkillsStrategy {
  apply(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition>;
}

// ── InjectSkillsStrategy ──────────────────────────────────────────────────────

/**
 * Delivers skills by injecting a notice into the agent system prompt.
 * Used by the ReAct agent, which accesses skills via `list_skill_files` and
 * `read_skill_file` tool calls.
 */
export class InjectSkillsStrategy implements SkillsStrategy {
  async apply(evalDef: EvalDefinition, _workspace: string): Promise<EvalDefinition> {
    return augmentWithSkills(evalDef);
  }
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
