/**
 * Skills runner — clones auth0/agent-skills and injects a notice into the
 * agent system prompt so the agent can browse skills on demand using the
 * `list_skill_files` and `read_skill_file` tools.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { SKILLS_REMOTE_DIR, SKILLS_CLONE_DIR } from '../agent_eval/skills-config.js';
import type { EvalDefinition } from './loader.js';

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
    console.log(`  [skills] failed to clone/pull — ${e}`);
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

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
