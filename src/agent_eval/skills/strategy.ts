/**
 * Skills delivery for agent runs.
 *
 * Contains the full skills pipeline: cloning the agent-skills repo, augmenting
 * or copying skill content into the agent context, and the SkillsStrategy
 * interface + implementations that select the right delivery method per agent.
 *
 *   - InjectSkillsStrategy  (ReAct-style agents)
 *       Augments the system prompt with skill names and tool hints. The agent
 *       accesses skill files via `list_skill_files` / `read_skill_file` tools.
 *
 *   - CopySkillsStrategy  (filesystem-native agents: Claude Code, etc.)
 *       Copies skill files into the workspace under `.claude/skills/<skill>/`
 *       so Claude Code auto-loads them as context.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { logger } from '../../utils/logger.js';
import { SKILLS_REMOTE_DIR, SKILLS_CLONE_DIR, resolveSkillDir } from './config.js';
import { collectFiles } from '../tools/utils.js';
import type { EvalDefinition } from '../../runners/loader.js';

// ── Config ────────────────────────────────────────────────────────────────────

const REMOTE_REPO_URL = 'https://github.com/auth0/agent-skills.git';

// ── Clone / pull (runs once per process) ─────────────────────────────────────

let cloneReady: Promise<boolean> | undefined;

function ensureCloned(): Promise<boolean> {
  if (!cloneReady) {
    cloneReady = doEnsureCloned().then((result) => {
      if (!result) cloneReady = undefined; // reset on failure so next call retries
      return result;
    });
  }
  return cloneReady;
}

async function doEnsureCloned(): Promise<boolean> {
  try {
    if (existsSync(join(SKILLS_CLONE_DIR, '.git'))) {
      execFileSync('git', ['pull'], { cwd: SKILLS_CLONE_DIR, stdio: 'pipe' });
    } else {
      if (existsSync(SKILLS_CLONE_DIR)) {
        // Directory exists but is not a git repo (e.g. partial/corrupt clone) — remove it
        rmSync(SKILLS_CLONE_DIR, { recursive: true, force: true });
      }
      mkdirSync(SKILLS_REMOTE_DIR, { recursive: true });
      execFileSync('git', ['clone', '--depth', '1', REMOTE_REPO_URL, SKILLS_CLONE_DIR], { stdio: 'pipe' });
    }
    return true;
  } catch (e) {
    logger.error(`  [skills] failed to clone/pull — ${e}`);
    return false;
  }
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Copies skill files into `.claude/skills/<skill>/` in the workspace so Claude Code
 * auto-loads them as persistent context. No prompt augmentation is needed.
 */
export async function copySkillsToWorkspace(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
  await ensureCloned();

  for (const skill of evalDef.skills) {
    const skillDir = resolveSkillDir(skill);
    if (!skillDir) {
      throw new Error(`Skill '${skill}' not found in cloned repo — cannot run agent+skills without it`);
    }
    const files = collectFiles(skillDir, skillDir, Infinity);
    for (const relPath of files) {
      const dest = join(workspace, '.claude', 'skills', skill, relPath);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(skillDir, relPath), dest);
    }
    logger.info(`  [skills] Copied ${files.length} file(s) for '${skill}' → .claude/skills/${skill}/`);
  }

  // No prompt augmentation needed — Claude Code auto-loads .claude/skills/ as context.
  return evalDef;
}

export async function augmentWithSkills(evalDef: EvalDefinition): Promise<EvalDefinition> {
  if (!evalDef.skills.length) {
    return evalDef;
  }

  await ensureCloned();

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
 * SkillsStrategy interface and implementations.
 *
 * Skills can be delivered to an agent in different ways depending on how that
 * agent accesses external context:
 *
 *   - InjectSkillsStrategy  (ReAct-style agents)
 *       Prepends a skills notice and tool hints to evalDef.agentSystemPrompt.
 *       The agent accesses skills via the `list_skill_files` / `read_skill_file`
 *       custom tools.
 *
 *   - CopySkillsStrategy  (filesystem-native agents such as Claude Code)
 *       Copies skill files into the workspace under `.claude/skills/<skill>/`
 *       so Claude Code auto-loads them as context.
 *
 * When adding a new agent, pick the strategy that matches how it reads context
 * — no need to re-implement the injection logic.
 */

export interface SkillsStrategy {
  /**
   * Prepare skills for an agent run.
   *
   * Receives the current EvalDefinition and the workspace path, and returns a
   * (possibly new) EvalDefinition with skills made available in the way this
   * strategy expects.
   *
   * `workspace` is provided for filesystem-native strategies that write skill
   * files into the agent's working directory. Prompt-based strategies (e.g.
   * InjectSkillsStrategy) do not use the workspace and may ignore it.
   *
   * Only called when `tools` contains `'skills'`.
   */
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
 * Delivers skills by copying files into `.claude/skills/` in the workspace.
 * Claude Code auto-loads this directory as persistent context.
 */
export class CopySkillsStrategy implements SkillsStrategy {
  async apply(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    return copySkillsToWorkspace(evalDef, workspace);
  }
}

// ── CopilotSdkSkillsStrategy ──────────────────────────────────────────────────

/**
 * Delivers skills for the Copilot SDK runner.
 *
 * Copies skill files into `.github/skills/<skill>/` in the workspace.
 * The SDK's `skillDirectories` session config option then points at
 * `.github/skills/` so the Copilot CLI discovers each SKILL.md automatically
 * — no prompt modification needed.
 */
export class CopilotSdkSkillsStrategy implements SkillsStrategy {
  async apply(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    await ensureCloned();

    for (const skill of evalDef.skills) {
      const skillDir = resolveSkillDir(skill);
      if (!skillDir) {
        throw new Error(`Skill '${skill}' not found in cloned repo — cannot run agent+skills without it`);
      }
      const files = collectFiles(skillDir, skillDir, Infinity);
      for (const relPath of files) {
        const dest = join(workspace, '.github', 'skills', skill, relPath);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(skillDir, relPath), dest);
      }
      logger.info(`  [skills] Copied ${files.length} file(s) for '${skill}' → .github/skills/${skill}/`);
    }

    // No prompt modification — the SDK uses skillDirectories config to discover skills.
    return evalDef;
  }
}

// ── GeminiCliSkillsStrategy ───────────────────────────────────────────────────

/**
 * Delivers skills for the Gemini CLI runner.
 *
 * Copies skill files into `.gemini/skills/<skill>/` in the workspace and writes
 * a `GEMINI.md` at the workspace root. The Gemini CLI auto-loads `GEMINI.md`
 * as persistent context (same convention as Claude Code's `CLAUDE.md`), so the
 * model sees the skill instructions without any prompt modification.
 */
export class GeminiCliSkillsStrategy implements SkillsStrategy {
  async apply(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    await ensureCloned();

    const skillLines: string[] = [];

    for (const skill of evalDef.skills) {
      const skillDir = resolveSkillDir(skill);
      if (!skillDir) {
        throw new Error(`Skill '${skill}' not found in cloned repo — cannot run agent+skills without it`);
      }
      const files = collectFiles(skillDir, skillDir, Infinity);
      for (const relPath of files) {
        const dest = join(workspace, '.gemini', 'skills', skill, relPath);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(skillDir, relPath), dest);
      }
      logger.info(`  [skills] Copied ${files.length} file(s) for '${skill}' → .gemini/skills/${skill}/`);
      skillLines.push(`- .gemini/skills/${skill}/SKILL.md`);
    }

    // Write GEMINI.md so the Gemini CLI auto-loads skill instructions as context.
    const geminiMd =
      `# Skills\n\n` +
      `The following Auth0 SDK skills are available. Read each SKILL.md before starting:\n\n` +
      skillLines.join('\n') +
      '\n';
    writeFileSync(join(workspace, 'GEMINI.md'), geminiMd, 'utf-8');
    logger.info(`  [skills] Wrote GEMINI.md with ${evalDef.skills.length} skill(s)`);

    return evalDef;
  }
}
