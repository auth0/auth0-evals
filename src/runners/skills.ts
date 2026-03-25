/**
 * Skills loader — fetches and injects SKILL.md context into eval prompts.
 *
 * Each eval declares which skills to load in its PROMPT.md frontmatter. This
 * module resolves SKILL.md files and augments the eval's agentSystemPrompt
 * with the skill content.
 *
 * Resolution order is controlled by the SKILLS_SOURCE environment variable:
 *
 *   auto   (default) — tries remote GitHub first; on any failure, falls back
 *                       to the local skills directory. Ideal for local dev.
 *   local             — reads only from SKILLS_LOCAL_DIR. No network calls.
 *                       Use this for offline testing or CI without network.
 *   remote            — reads only from remote GitHub. Original behaviour.
 *
 * Local directory layout must mirror the remote repo structure:
 *
 *   ${SKILLS_LOCAL_DIR}/
 *     {skill-name}/
 *       SKILL.md
 *
 * Environment variables:
 *   SKILLS_SOURCE     auto | local | remote  (default: auto)
 *   SKILLS_LOCAL_DIR  path to local skills root  (default: ./skills)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { EvalDefinition } from './loader.js';

// ── Config ────────────────────────────────────────────────────────────────────

type SkillsSource = 'auto' | 'local' | 'remote';

const VALID_SOURCES: SkillsSource[] = ['auto', 'local', 'remote'];

function parseSkillsSource(): SkillsSource {
  const raw = (process.env.SKILLS_SOURCE ?? 'auto').toLowerCase();
  if (VALID_SOURCES.includes(raw as SkillsSource)) {
    return raw as SkillsSource;
  }
  console.warn(`  [skills] Unknown SKILLS_SOURCE='${raw}', defaulting to 'auto'`);
  return 'auto';
}

const SKILLS_SOURCE: SkillsSource = parseSkillsSource();
const SKILLS_LOCAL_DIR: string = resolve(process.env.SKILLS_LOCAL_DIR ?? 'skills');

const REMOTE_URL_TEMPLATE =
  'https://raw.githubusercontent.com/auth0/agent-skills/main' + '/plugins/auth0-sdks/skills/{name}/SKILL.md';

// Module-level cache so parallel workers don't re-fetch the same skill
const skillCache: Record<string, string> = {};

// ── Public API ────────────────────────────────────────────────────────────────

export async function augmentWithSkills(evalDef: EvalDefinition): Promise<EvalDefinition> {
  /**
   * Return a copy of evalDef with skill content prepended to agentSystemPrompt.
   * If the eval has no skills declared, returns the original evalDef unchanged.
   */
  if (!evalDef.skills.length) {
    return evalDef;
  }

  const skillContext = await loadSkills(evalDef.skills);
  if (!skillContext) {
    return evalDef;
  }

  const parts = ['## SDK Reference Material\n\n' + skillContext];
  if (evalDef.agentSystemPrompt) {
    parts.push(evalDef.agentSystemPrompt);
  }
  const augmentedAgentSystem = parts.join('\n\n---\n\n');

  return { ...evalDef, agentSystemPrompt: augmentedAgentSystem };
}

// ── Orchestration ─────────────────────────────────────────────────────────────

async function loadSkills(skillNames: string[]): Promise<string> {
  const parts: string[] = [];
  for (const name of skillNames) {
    const content = await resolveOne(name);
    if (content) {
      parts.push(`### ${name}\n\n${content}`);
    } else {
      console.warn(`  [skills] Warning: could not load skill '${name}' (source: ${SKILLS_SOURCE})`);
    }
  }
  return parts.join('\n\n---\n\n');
}

async function resolveOne(name: string): Promise<string> {
  if (name in skillCache) {
    return skillCache[name]!;
  }

  let content: string;

  if (SKILLS_SOURCE === 'local') {
    content = readLocal(name);
  } else if (SKILLS_SOURCE === 'remote') {
    content = await fetchRemote(name);
  } else {
    // auto: remote first, local fallback
    content = await fetchRemote(name);
    if (!content) {
      const local = readLocal(name);
      if (local) {
        console.log(`  [skills] '${name}': remote unavailable, using local fallback`);
        content = local;
      }
    }
  }

  skillCache[name] = content;
  return content;
}

// ── Remote source ─────────────────────────────────────────────────────────────

async function fetchRemote(name: string): Promise<string> {
  const url = REMOTE_URL_TEMPLATE.replace('{name}', name);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'auth0-eval-agent/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const content = (await resp.text()).trim();
    console.log(`  [skills] '${name}': loaded from remote`);
    return content;
  } catch (e) {
    console.log(`  [skills] '${name}': remote fetch failed — ${e}`);
    return '';
  }
}

// ── Local source ──────────────────────────────────────────────────────────────

function readLocal(name: string): string {
  const skillPath = join(SKILLS_LOCAL_DIR, name, 'SKILL.md');
  if (!existsSync(skillPath)) {
    return '';
  }
  try {
    const content = readFileSync(skillPath, 'utf-8').trim();
    console.log(`  [skills] '${name}': loaded from local (${skillPath})`);
    return content;
  } catch (e) {
    console.warn(`  [skills] '${name}': failed to read local file at ${skillPath} — ${e}`);
    return '';
  }
}
