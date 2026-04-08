/**
 * Braintrust experiment reporter.
 *
 * Logs each eval result as an experiment entry in Braintrust for
 * cross-run analytics and persistent score storage.
 *
 * Opt-in via --braintrust flag. Requires BRAINTRUST_API_KEY.
 */

import { init as btInit, type Experiment } from 'braintrust';
import type { JobResult } from '../types/results.js';
import { logger } from '../utils/logger.js';

const PROJECT_ID = '38395851-dd41-46ec-a971-a30402db6921';

export interface BraintrustReporter {
  log(result: JobResult): void;
  summarize(): Promise<void>;
}

/**
 * Build a Braintrust experiment name from the run parameters.
 */
function experimentName(mode: string, tools: string[]): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = tools.length > 0 ? `-${tools.join('+')}` : '';
  return `${mode}${suffix}-${ts}`;
}

/**
 * Map a flat eval result to Braintrust's log shape.
 *
 * Key design decisions:
 * - `scores` only contains UNIVERSAL metrics (grader_pass_rate, overall_score)
 *   that every row has. This avoids sparse columns in the table when different
 *   evals have different grader names.
 * - Per-grader breakdown goes in `metadata.graders` for drill-down.
 * - `span_attributes.name` sets the row label in the UI.
 * - `input`/`output` are strings so they render readably (not collapsed JSON).
 */
function mapResult(result: JobResult): {
  input: string;
  output: string;
  scores: Record<string, number>;
  metrics: Record<string, number>;
  metadata: Record<string, unknown>;
  tags: string[];
  spanAttributes: { name: string; type: string };
} {
  const graders = 'graders' in result ? result.graders : [];
  const dimensions = 'dimensions' in result ? result.dimensions : [];

  // Scores: only universal metrics that every row has — clean columns, no sparsity
  const scores: Record<string, number> = {};
  if ('grader_pass_rate' in result) scores['grader_pass_rate'] = result.grader_pass_rate;
  if ('overall_score' in result) scores['overall_score'] = result.overall_score / 100;

  // Metrics: numeric perf data Braintrust can chart natively
  const metrics: Record<string, number> = {
    duration_ms: result.wall_time * 1000,
    total_tokens: result.tokens,
    cost_usd: result.cost_usd,
  };
  if ('active_time' in result) metrics['active_time_ms'] = result.active_time * 1000;
  if ('tool_calls' in result) metrics['tool_calls'] = result.tool_calls;
  if ('interruptions' in result) metrics['interruptions'] = result.interruptions;

  // Tags: one-click filter chips in the Braintrust UI
  const tags: string[] = [result.mode];
  if (result.category) tags.push(result.category);
  const tools = 'tools' in result ? result.tools : [];
  if (tools.length > 0) tags.push(...tools);

  // Per-grader and per-dimension detail — available on row drill-down, not as columns
  const graderDetail = graders.map((g) => ({ name: g.name, kind: g.kind, passed: g.passed }));
  const dimensionDetail = dimensions.map((d) => ({ name: d.name, score: d.score, weight: d.weight }));

  return {
    input: 'prompt' in result ? result.prompt : '',
    output: 'response_text' in result ? result.response_text : '',
    scores,
    metrics,
    metadata: {
      model: result.model,
      mode: result.mode,
      eval_id: result.eval_id,
      category: result.category,
      tools,
      session_id: 'session_id' in result ? result.session_id : undefined,
      status: result.status,
      overall_grade: 'overall_grade' in result ? result.overall_grade : undefined,
      error: 'error' in result ? result.error : undefined,
      graders: graderDetail,
      dimensions: dimensionDetail,
    },
    tags,
    spanAttributes: {
      name: `${result.eval_id} / ${result.model}`,
      type: 'eval',
    },
  };
}

/**
 * Create a Braintrust reporter bound to a single experiment.
 * Returns null if BRAINTRUST_API_KEY is not set.
 */
export async function createBraintrustReporter(mode: string, tools: string[]): Promise<BraintrustReporter | null> {
  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    logger.info('[Braintrust] BRAINTRUST_API_KEY not set — skipping.');
    return null;
  }

  const name = experimentName(mode, tools);
  let experiment: Experiment;
  try {
    experiment = btInit(PROJECT_ID, {
      experiment: name,
      apiKey,
    });
  } catch (e) {
    logger.error(`[Braintrust] Failed to initialize experiment: ${e}`);
    return null;
  }

  logger.info(`[Braintrust] Experiment initialized: ${name}`);

  return {
    log(result: JobResult): void {
      const { input, output, scores, metrics, metadata, tags, spanAttributes } = mapResult(result);
      // Use traced() instead of log() to work within autoevals' span context.
      // traced() creates a child span that logs correctly regardless of global state.
      void experiment.traced(
        (span) => {
          span.log({ input, output, scores, metrics, metadata, tags });
        },
        { name: spanAttributes.name, type: spanAttributes.type as 'eval' },
      );
    },

    async summarize(): Promise<void> {
      try {
        const summary = await experiment.summarize();
        logger.info(`[Braintrust] Experiment: ${summary.experimentUrl}`);
      } catch (e) {
        logger.error(`[Braintrust] Failed to summarize: ${e}`);
      }
    },
  };
}

// Exported for testing
export { experimentName, mapResult };
