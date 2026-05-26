/**
 * Convenience wrapper that assembles skill content and calls generateRecommendations.
 * Used by both run.ts (local execution) and sandbox-runner.ts (Docker execution).
 */

import { getFrameworkConfig, getSkillsManager } from '@a0/eval-core';
import type { RunRecord, ScoredResult, Recommendations, EvalDefinition } from '@a0/eval-core';
import { generateRecommendations } from './generator.js';
import { collectSkillContent } from './collect-skill-content.js';

/**
 * Generates recommendations for a completed agent run.
 * Returns undefined if skills/MCP are not enabled or if generation fails.
 */
export async function generateRunRecommendations(
  evalDef: EvalDefinition,
  resolvedModel: string,
  tools: string[],
  workspace: string,
  scored: ScoredResult,
  record: RunRecord,
  apiKey: string,
): Promise<Recommendations | undefined> {
  if (!tools.includes('skills') && !tools.includes('mcp')) return undefined;

  const config = getFrameworkConfig();
  const manager = getSkillsManager();
  const skillDirs: Record<string, string | null> = {};
  for (const skill of evalDef.skills) {
    skillDirs[skill] = manager.resolveSkillDir(skill);
  }

  return generateRecommendations({
    evalId: evalDef.id,
    model: resolvedModel,
    tools,
    userPrompt: evalDef.userPrompt,
    workspace,
    scored,
    record,
    skillContent: collectSkillContent(skillDirs),
    apiKey,
    baseUrl: config.proxy.baseUrl,
    judgeModel: config.judge.model ?? 'claude-sonnet-4-5',
  });
}
