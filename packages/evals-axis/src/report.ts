/**
 * Maps AXIS ScoredOutput + auth0-evals grader results to AgentJobResult[],
 * the format consumed by @a0/evals-reporter's renderHtml().
 *
 * Exported as a standalone module so it can be tested independently of the
 * run entry point, which triggers side-effects on import.
 */

import type { ScoredOutput, TranscriptEntry } from '@netlify/axis';
import type { GraderResult } from '@a0/evals-graders';
import type { AgentJobResult, AgentType, DimensionSummary, GraderSummary } from '@a0/evals-core';
import { estimateCost } from '@a0/evals-core';

/**
 * Maps AXIS agent names (the `agent` field in axis.config.ts agents[]) to our
 * AgentType identifiers. The AXIS gemini adapter is named "gemini" but our
 * framework uses "gemini-cli" — without this mapping the fallback fires and
 * every gemini result is mislabelled as "claude-code".
 */
const AXIS_AGENT_TO_TYPE: Record<string, AgentType> = {
  'claude-code': 'claude-code',
  codex: 'codex',
  gemini: 'gemini-cli',
  copilot: 'copilot',
};

/**
 * Tool names that represent user-interruption calls across all runners.
 * claude-code uses AskUserQuestion; copilot uses ask_user.
 */
const INTERRUPTION_TOOL_NAMES = new Set(['AskUserQuestion', 'ask_user']);

/**
 * Sums token usage across judge grader results and estimates cost.
 * Mirrors the private computeJudgeCost helper in @a0/evals-core serializers.
 */
function computeJudgeCost(graderResults: GraderResult[]): number {
  let total = 0;
  for (const gr of graderResults) {
    const input = gr.inputTokens ?? 0;
    const output = gr.outputTokens ?? 0;
    if ((input > 0 || output > 0) && gr.judgeModel) {
      total += estimateCost(gr.judgeModel, input, output);
    }
  }
  return total;
}

/**
 * Counts interruption tool calls in an AXIS transcript.
 *
 * Two formats are handled:
 *  - Standard (Codex, Gemini, Copilot): tool calls appear as top-level
 *    entries with type === 'tool_use' and content.name set.
 *  - Claude Code: tool calls are embedded inside type === 'assistant' entries
 *    as content.message.content[].type === 'tool_use' blocks.
 */
export function countInterruptions(transcript: TranscriptEntry[]): number {
  let count = 0;
  for (const entry of transcript) {
    const c = (entry.content ?? {}) as Record<string, unknown>;
    if (entry.type === 'tool_use') {
      const name = c['name'] as string | undefined;
      if (name && INTERRUPTION_TOOL_NAMES.has(name)) count++;
    } else if (entry.type === 'assistant') {
      const innerContent = (c['message'] as Record<string, unknown> | undefined)?.['content'];
      if (Array.isArray(innerContent)) {
        for (const block of innerContent as Record<string, unknown>[]) {
          if (block['type'] === 'tool_use' && INTERRUPTION_TOOL_NAMES.has(block['name'] as string)) {
            count++;
          }
        }
      }
    }
  }
  return count;
}

/**
 * Converts AXIS scored results and auth0-evals grader results into the
 * AgentJobResult format used by the HTML reporter.
 *
 * tools: ['axis'] puts results in a dedicated AGENT+AXIS tab, keeping them
 * separate from regular agent runs.
 *
 * cost_usd reflects AXIS's combined totalCostUsd (agent + AXIS internal judge);
 * no per-component AXIS breakdown is available. judge_cost_usd is computed
 * separately from the auth0-evals grader judge runs (the judge() primitive),
 * and total_cost_usd is the sum of both.
 */
export function buildAxisScores(
  output: ScoredOutput,
  allGraderResults: Map<string, GraderResult[]>,
  /** Maps scenario key → eval category (e.g. 'quickstarts'). Falls back to '' if omitted. */
  categories: Record<string, string> = {},
): AgentJobResult[] {
  return output.results.map((result) => {
    const key = `${result.scenarioKey}|${result.agentName}`;
    const graders = allGraderResults.get(key) ?? [];
    const passed = graders.filter((g) => g.passed).length;
    const judgeCost = computeJudgeCost(graders);

    // agentName format: "claude-code|global.anthropic.claude-opus-4-8"
    // This pipe-separated convention is set by axis.config.ts agents[] and is
    // not guaranteed by the AXIS API — if the format changes, rawAgentType
    // falls through to the claude-code default and model falls back to agentName.
    const [rawAgentType, model] = result.agentName.split('|');
    const agentType: AgentType = AXIS_AGENT_TO_TYPE[rawAgentType ?? ''] ?? 'claude-code';

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

    const graderSummaries: GraderSummary[] = graders.map((g) => {
      const summary: GraderSummary = {
        name: g.name,
        kind: g.kind,
        passed: g.passed,
        detail: g.detail,
        level: g.level,
      };
      if ((g.inputTokens || g.outputTokens) && g.judgeModel) {
        summary.cost_usd = estimateCost(g.judgeModel, g.inputTokens ?? 0, g.outputTokens ?? 0);
      }
      return summary;
    });

    const tokenUsage = result.output.metadata.tokenUsage;

    return {
      eval_id: result.scenarioKey,
      category: categories[result.scenarioKey] ?? '',
      prompt: result.prompt,
      // Fall back to the AXIS error description so failed runs show why they
      // failed in the HTML report rather than an unhelpful blank field.
      response_text: result.output.result ?? result.output.metadata.error ?? '',
      model: model ?? result.agentName,
      mode: 'agent',
      agent_type: agentType,
      tools: ['axis'],
      session_id: result.scenarioKey,
      // A run is successful only when the process exited cleanly and AXIS did
      // not set an error description. Matching AXIS's own isFailedRun() check
      // ensures our status field agrees with the completed/failed summary.
      status: result.output.metadata.exitCode === 0 && !result.output.metadata.error ? 'success' : 'failure',
      overall_score: result.score.axisScore,
      overall_grade: scoreToGrade(result.score.axisScore),
      grader_pass_rate: graders.length > 0 ? passed / graders.length : 0,
      wall_time: result.output.metadata.durationMs / 1000,
      active_time: (result.score.sparseIndex?.stats.totalDurationMs ?? 0) / 1000,
      // The AXIS claude-code adapter stores tool calls inside assistant entries,
      // not as separate tool_use entries. Use transcriptAnalysis.toolUseCount
      // (populated during scoring and re-classifying claude-code assistant+tool_use
      // blocks) so the count is correct regardless of adapter.
      tool_calls:
        result.output.transcriptAnalysis?.toolUseCount ??
        result.output.transcript.filter((e) => e.type === 'tool_use').length,
      interruptions: countInterruptions(result.output.transcript),
      tokens: tokenUsage ? tokenUsage.input + tokenUsage.output + (tokenUsage.cacheReadInput ?? 0) : 0,
      cost_usd: result.output.metadata.totalCostUsd ?? 0,
      judge_cost_usd: judgeCost,
      total_cost_usd: (result.output.metadata.totalCostUsd ?? 0) + judgeCost,
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
