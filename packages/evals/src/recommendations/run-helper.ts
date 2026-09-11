/**
 * Convenience wrapper that assembles skill content and calls generateRecommendations.
 * Used by both run.ts (local execution) and sandbox-runner.ts (Docker execution).
 */

import { getFrameworkConfig, getSkillsManager } from '@a0/evals-core';
import type { RunRecord, ScoredResult, Recommendations, EvalDefinition } from '@a0/evals-core';
import { generateRecommendations } from './generator.js';
import { collectSkillFiles } from './collect-skill-content.js';
import type { SkillFile } from './collect-skill-content.js';

/**
 * Generates recommendations for a completed agent run.
 *
 * Runs for every agent job, including one with no tools at all. That run is the
 * control: same task, same graders, same workspace, no skill and no MCP. If correct
 * work fails a check there, the check is the suspect, and skipping the diagnosis on
 * exactly those runs threw away the only evidence that separates a grader defect
 * from a documentation defect.
 *
 * Never throws — a failed analysis comes back carrying its reason (see
 * `generateRecommendations`).
 */
export async function generateRunRecommendations(
  evalDef: EvalDefinition,
  resolvedModel: string,
  tools: string[],
  workspace: string,
  scored: ScoredResult,
  record: RunRecord,
  apiKey: string,
): Promise<Recommendations> {
  const config = getFrameworkConfig();

  // Only send the skill when the skill was actually in the agent's context. Handing
  // the analyst documentation the agent never saw is how a control run acquires an
  // invented "the skill should say X" finding.
  let skillFiles: SkillFile[] | undefined;
  if (tools.includes('skills')) {
    const manager = getSkillsManager();
    const skillDirs: Record<string, string | null> = {};
    for (const skill of evalDef.skills) {
      skillDirs[skill] = manager.resolveSkillDir(skill);
    }
    skillFiles = collectSkillFiles(skillDirs);
  }

  return generateRecommendations({
    evalId: evalDef.id,
    model: resolvedModel,
    tools,
    userPrompt: evalDef.userPrompt,
    workspace,
    scored,
    record,
    skillContent: '',
    skillFiles,
    apiKey,
    baseUrl: config.proxy.baseUrl,
    judgeModel: config.judge.model ?? 'claude-sonnet-4-5',
  });
}
