/**
 * Cross-run aggregation of the per-run recommendations.
 *
 * The per-run panels answer "what went wrong in this run". They cannot answer the
 * question that actually drives work: which problem shows up across many runs. A
 * finding that eight models hit is a documentation or grader defect; the same
 * finding on one model is that model having a bad day. Reading twenty tabs to tell
 * those apart is why nobody read them, so the report gets one ranked list.
 */

/** One recommendation, plus the runs it was reported on. */
export interface AggregatedIssue {
  category: string;
  root_cause: string;
  /** Grader / skill / file the finding points at; empty when the finding had no context. */
  context: string;
  /** Highest severity any run reported for this issue. */
  severity: 'high' | 'medium' | 'low';
  /** Number of distinct runs (eval × model × variant) reporting it. */
  run_count: number;
  /** Distinct models that hit it, sorted. */
  models: string[];
  /** Distinct evals it was seen in, sorted. */
  evals: string[];
  /** Distinct `issue` texts folded into this group, longest-first (most specific). */
  issues: string[];
  /** Distinct `suggestion` texts, longest-first. */
  suggestions: string[];
}

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Group key. Category and root cause are closed vocabularies, so they group cleanly;
 * `context` is free text from the model, so it is normalised (lowercased, punctuation
 * and backticks stripped, whitespace collapsed) before it joins the key. Without that
 * `grader "Created org acme"` and `Grader: created org acme` become two rows and the
 * ranking is wrong in exactly the place it matters.
 */
function groupKey(category: string, rootCause: string, context: string): string {
  const normalized = context
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${category}|${rootCause}|${normalized}`;
}

function pushUnique(list: string[], value: string | undefined): void {
  if (value && !list.includes(value)) list.push(value);
}

/**
 * Folds every run's recommendations into one ranked list.
 *
 * Ordering is run count first, severity second: a medium-severity finding on eight
 * runs is more actionable than a high-severity one-off, because the repeat is
 * evidence and the one-off is a hypothesis.
 *
 * Results whose analysis failed contribute nothing here — they carry an `error`
 * instead of findings, and the per-run panel is where that is surfaced.
 */
export function aggregateRecommendations(results: Record<string, unknown>[]): AggregatedIssue[] {
  const groups = new Map<string, AggregatedIssue>();

  for (const result of results) {
    const recs = result.recommendations as { recommendations?: Record<string, unknown>[] } | undefined;
    const list = recs?.recommendations;
    if (!Array.isArray(list)) continue;

    const model = String(result.model ?? '');
    const evalId = String(result.eval_id ?? '');

    // A run reporting the same issue twice must count once, or a chatty analysis
    // outranks a repeat across models.
    const seenInThisRun = new Set<string>();

    for (const rec of list) {
      const category = String(rec.category ?? 'other');
      const rootCause = String(rec.root_cause ?? 'unspecified');
      const context = String(rec.context ?? '');
      const key = groupKey(category, rootCause, context);

      let group = groups.get(key);
      if (!group) {
        group = {
          category,
          root_cause: rootCause,
          context,
          severity: 'low',
          run_count: 0,
          models: [],
          evals: [],
          issues: [],
          suggestions: [],
        };
        groups.set(key, group);
      }

      if (!seenInThisRun.has(key)) {
        seenInThisRun.add(key);
        group.run_count += 1;
        pushUnique(group.models, model);
        pushUnique(group.evals, evalId);
      }

      const severity = String(rec.severity ?? 'low');
      if ((SEVERITY_RANK[severity] ?? 0) > (SEVERITY_RANK[group.severity] ?? 0)) {
        group.severity = severity as AggregatedIssue['severity'];
      }
      pushUnique(group.issues, rec.issue ? String(rec.issue) : undefined);
      pushUnique(group.suggestions, rec.suggestion ? String(rec.suggestion) : undefined);
    }
  }

  const byLengthDesc = (a: string, b: string): number => b.length - a.length;

  return [...groups.values()]
    .map((group) => ({
      ...group,
      models: [...group.models].sort(),
      evals: [...group.evals].sort(),
      issues: [...group.issues].sort(byLengthDesc),
      suggestions: [...group.suggestions].sort(byLengthDesc),
    }))
    .sort(
      (a, b) =>
        b.run_count - a.run_count ||
        (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
        a.category.localeCompare(b.category) ||
        a.context.localeCompare(b.context),
    );
}

/** Runs whose recommendation analysis failed, for the aggregate header. */
export function countFailedAnalyses(results: Record<string, unknown>[]): number {
  return results.filter((r) => {
    const recs = r.recommendations as { error?: string } | undefined;
    return Boolean(recs?.error);
  }).length;
}
