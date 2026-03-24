/**
 * Braintrust experiment reporter.
 *
 * Logs each eval result as an experiment entry in Braintrust for
 * cross-run analytics and persistent score storage.
 *
 * Opt-in via --braintrust flag. Requires BRAINTRUST_API_KEY.
 */

import { init as btInit, type Experiment } from 'braintrust';

const PROJECT_ID = '38395851-dd41-46ec-a971-a30402db6921';

export interface BraintrustReporter {
  log(result: Record<string, unknown>): void;
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
function mapResult(result: Record<string, unknown>): {
  input: string;
  output: string;
  scores: Record<string, number>;
  metrics: Record<string, number>;
  metadata: Record<string, unknown>;
  tags: string[];
  spanAttributes: { name: string; type: string };
} {
  const graders = (result.graders as { name: string; kind: string; passed: boolean }[]) ?? [];
  const dimensions = (result.dimensions as { name: string; score: number; weight: number }[]) ?? [];

  // Scores: only universal metrics that every row has — clean columns, no sparsity
  const scores: Record<string, number> = {};
  if (typeof result.grader_pass_rate === 'number') {
    scores['grader_pass_rate'] = result.grader_pass_rate;
  }
  if (typeof result.overall_score === 'number') {
    scores['overall_score'] = (result.overall_score as number) / 100;
  }

  // Metrics: numeric perf data Braintrust can chart natively
  const metrics: Record<string, number> = {};
  if (typeof result.wall_time === 'number') metrics['duration_ms'] = result.wall_time as number;
  if (typeof result.active_time === 'number') metrics['active_time_ms'] = result.active_time as number;
  if (typeof result.tokens === 'number') metrics['total_tokens'] = result.tokens as number;
  if (typeof result.cost_usd === 'number') metrics['cost_usd'] = result.cost_usd as number;
  if (typeof result.tool_calls === 'number') metrics['tool_calls'] = result.tool_calls as number;
  if (typeof result.interruptions === 'number') metrics['interruptions'] = result.interruptions as number;

  // Tags: one-click filter chips in the Braintrust UI
  const tags: string[] = [];
  if (result.mode) tags.push(result.mode as string);
  if (result.category) tags.push(result.category as string);
  const tools = (result.tools as string[]) ?? [];
  if (tools.length > 0) tags.push(...tools);

  // Per-grader and per-dimension detail — available on row drill-down, not as columns
  const graderDetail = graders.map((g) => ({ name: g.name, kind: g.kind, passed: g.passed }));
  const dimensionDetail = dimensions.map((d) => ({
    name: d.name,
    score: d.score,
    weight: d.weight,
  }));

  return {
    input: (result.prompt as string) ?? '',
    output: (result.response_text as string) ?? '',
    scores,
    metrics,
    metadata: {
      model: result.model as string,
      mode: result.mode as string,
      eval_id: result.eval_id as string,
      category: (result.category as string) ?? '',
      tools,
      session_id: result.session_id,
      status: result.status as string,
      overall_grade: result.overall_grade,
      error: result.error,
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
export async function createBraintrustReporter(
  mode: string,
  tools: string[],
): Promise<BraintrustReporter | null> {
  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    console.log('[Braintrust] BRAINTRUST_API_KEY not set — skipping.');
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
    console.log(`[Braintrust] Failed to initialize experiment: ${e}`);
    return null;
  }

  console.log(`[Braintrust] Experiment initialized: ${name}`);

  return {
    log(result: Record<string, unknown>): void {
      const { input, output, scores, metrics, metadata, tags, spanAttributes } = mapResult(result);
      experiment.log({
        input,
        output,
        scores,
        metrics,
        metadata,
        tags,
        span_attributes: spanAttributes,
      });
    },

    async summarize(): Promise<void> {
      try {
        const summary = await experiment.summarize();
        console.log(`[Braintrust] Experiment: ${summary.experimentUrl}`);
      } catch (e) {
        console.log(`[Braintrust] Failed to summarize: ${e}`);
      }
    },
  };
}

// Exported for testing
export { experimentName, mapResult };
