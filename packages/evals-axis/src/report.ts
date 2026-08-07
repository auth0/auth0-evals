/**
 * Maps AXIS ScoredOutput + auth0-evals grader results to AgentJobResult[],
 * the format consumed by @a0/evals-reporter's renderHtml().
 *
 * Exported as a standalone module so it can be tested independently of the
 * run entry point, which triggers side-effects on import.
 */

import type { ScoredOutput } from '@netlify/axis';
import type { GraderResult } from '@a0/evals-graders';
import type { AgentJobResult, AgentType, DimensionSummary, GraderSummary } from '@a0/evals-core';

const KNOWN_AGENT_TYPES: AgentType[] = ['claude-code', 'copilot', 'gemini-cli', 'codex'];

/**
 * Converts AXIS scored results and auth0-evals grader results into the
 * AgentJobResult format used by the HTML reporter.
 *
 * tools: ['axis'] puts results in a dedicated AGENT+AXIS tab, keeping them
 * separate from regular agent runs.
 *
 * AXIS reports a combined totalCostUsd (agent + judge); no per-component
 * breakdown is available, so cost_usd and total_cost_usd both reflect the
 * combined value and judge_cost_usd is zero.
 */
export function buildAxisScores(output: ScoredOutput, allGraderResults: Map<string, GraderResult[]>): AgentJobResult[] {
  return output.results.map((result) => {
    const key = `${result.scenarioKey}|${result.agentName}`;
    const graders = allGraderResults.get(key) ?? [];
    const passed = graders.filter((g) => g.passed).length;

    // agentName format: "claude-code|global.anthropic.claude-opus-4-8"
    // This pipe-separated convention is set by axis.config.ts agents[] and is
    // not guaranteed by the AXIS API — if the format changes, rawAgentType
    // falls through to the claude-code default and model falls back to agentName.
    const [rawAgentType, model] = result.agentName.split('|');
    const agentType: AgentType = KNOWN_AGENT_TYPES.includes(rawAgentType as AgentType)
      ? (rawAgentType as AgentType)
      : 'claude-code';

    const dimensions: DimensionSummary[] = [
      {
        name: 'Goal Achievement',
        score: result.score.goalAchievement.score,
        grade: scoreToGrade(result.score.goalAchievement.score),
        weight: 0.4,
        weighted: result.score.goalAchievement.score * 0.4,
      },
      {
        name: 'Environment',
        score: result.score.environment.score,
        grade: scoreToGrade(result.score.environment.score),
        weight: 0.2,
        weighted: result.score.environment.score * 0.2,
      },
      {
        name: 'Service',
        score: result.score.service.score,
        grade: scoreToGrade(result.score.service.score),
        weight: 0.2,
        weighted: result.score.service.score * 0.2,
      },
      {
        name: 'Agent',
        score: result.score.agent.score,
        grade: scoreToGrade(result.score.agent.score),
        weight: 0.2,
        weighted: result.score.agent.score * 0.2,
      },
    ];

    const graderSummaries: GraderSummary[] = graders.map((g) => ({
      name: g.name,
      kind: g.kind,
      passed: g.passed,
      detail: g.detail,
      level: g.level,
    }));

    const tokenUsage = result.output.metadata.tokenUsage;

    return {
      eval_id: result.scenarioKey,
      category: 'axis',
      prompt: result.prompt,
      response_text: result.output.result ?? '',
      model: model ?? result.agentName,
      mode: 'agent',
      agent_type: agentType,
      tools: ['axis'],
      session_id: result.scenarioKey,
      status: result.output.metadata.exitCode === 0 ? 'success' : 'failure',
      overall_score: result.score.axisScore,
      overall_grade: scoreToGrade(result.score.axisScore),
      grader_pass_rate: graders.length > 0 ? passed / graders.length : 0,
      wall_time: result.output.metadata.durationMs / 1000,
      active_time: 0,
      tool_calls: result.output.transcript.filter((e) => e.type === 'tool_use').length,
      interruptions: 0,
      tokens: tokenUsage ? tokenUsage.input + tokenUsage.output + (tokenUsage.cacheReadInput ?? 0) : 0,
      cost_usd: result.output.metadata.totalCostUsd ?? 0,
      judge_cost_usd: 0,
      total_cost_usd: result.output.metadata.totalCostUsd ?? 0,
      dimensions,
      graders: graderSummaries,
      session_trace: [],
      turn_metrics: [],
    };
  });
}

/** Maps a 0–100 score to a letter grade using the framework's thresholds. */
export function scoreToGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}
