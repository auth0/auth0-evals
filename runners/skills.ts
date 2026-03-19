/**
 * Skills loader — fetches and injects SKILL.md context into eval prompts.
 *
 * Each eval declares which skills to load in its PROMPT.md frontmatter. This
 * module resolves SKILL.md files from the auth0/agent-skills GitHub repo and
 * augments the eval's system prompt with the skill content.
 *
 * In agent+skills mode, the augmented eval is then run through the full
 * agentic loop — the agent gets both tool access and skill context.
 */

import type { EvalDefinition } from './loader.js';

const AGENT_SKILLS_RAW =
  'https://raw.githubusercontent.com/auth0/agent-skills/main' +
  '/plugins/auth0-sdks/skills/{name}/SKILL.md';

// Module-level cache so parallel workers don't re-fetch the same file
const skillCache: Record<string, string> = {};

export async function augmentWithSkills(evalDef: EvalDefinition): Promise<EvalDefinition> {
  /**
   * Return a copy of evalDef with skill content injected into the system prompt.
   * If the eval has no skills declared, returns the original evalDef unchanged.
   */
  if (!evalDef.skills.length) {
    return evalDef;
  }

  const skillContext = await fetchSkills(evalDef.skills);
  if (!skillContext) {
    return evalDef;
  }

  const parts = ['## SDK Reference Material\n\n' + skillContext];
  if (evalDef.systemPrompt) {
    parts.push(evalDef.systemPrompt);
  }
  const augmentedSystem = parts.join('\n\n---\n\n');

  return { ...evalDef, systemPrompt: augmentedSystem };
}

// ── GitHub fetcher ─────────────────────────────────────────────────────────────

async function fetchSkills(skillNames: string[]): Promise<string> {
  const parts: string[] = [];
  for (const name of skillNames) {
    const content = await fetchOne(name);
    if (content) {
      parts.push(`### ${name}\n\n${content}`);
    } else {
      console.log(`  [skills] Warning: could not fetch skill '${name}'`);
    }
  }
  return parts.join('\n\n---\n\n');
}

async function fetchOne(name: string): Promise<string> {
  if (name in skillCache) {
    return skillCache[name];
  }

  const url = AGENT_SKILLS_RAW.replace('{name}', name);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'auth0-eval-agent/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const content = (await resp.text()).trim();
    skillCache[name] = content;
    return content;
  } catch (e) {
    console.log(`  [skills] Failed to fetch ${url}: ${e}`);
    skillCache[name] = '';
    return '';
  }
}
