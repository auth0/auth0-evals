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
 * Words too common in this corpus to say anything about *which* problem a finding is.
 * Every recommendation is about an agent, a skill and a reference, so those carry no
 * signal; dropping them keeps the overlap score driven by the subject matter.
 */
const STOPWORDS = new Set([
  'agent',
  'agents',
  'skill',
  'skills',
  'reference',
  'references',
  'grader',
  'graders',
  'index',
  'auth0',
  'never',
  'always',
  'should',
  'would',
  'could',
  'because',
  'without',
  'about',
  'which',
  'where',
  'there',
  'their',
  'these',
  'those',
  'while',
  'other',
  'another',
  'anything',
  'nothing',
  'something',
  'gives',
  'given',
  'tells',
  'says',
  'state',
  'value',
  'values',
  'field',
  'fields',
  'section',
  'guidance',
  'documents',
  'documented',
]);

/**
 * The distinctive terms a finding is about: backticked code spans, dotted or
 * underscored or kebab-cased names, file paths, and ordinary words of five letters
 * or more. A code span stays whole (`auth0 apps create` is one term), because a
 * shared command name is far stronger evidence of the same finding than three
 * shared words would be.
 */
function signature(text: string): Set<string> {
  const out = new Set<string>();
  const add = (term: string): void => {
    const value = term.trim().toLowerCase();
    if (value.length >= 4 && !STOPWORDS.has(value)) out.add(value);
  };
  for (const m of text.matchAll(/`([^`]+)`/g)) add(m[1] ?? '');
  for (const m of text.matchAll(/[a-z0-9]+(?:[._/-][a-z0-9]+)+/gi)) add(m[0]);
  for (const m of text.matchAll(/[a-z]{5,}/gi)) add(m[0]);
  // A finding worded entirely in short common words leaves nothing distinctive, and an
  // empty signature matches nothing — so two runs reporting it verbatim would each get
  // their own row and both rank as one-offs. Falling back to the whole text keeps the
  // exact-duplicate case working without loosening the match for everything else.
  if (out.size === 0) add(text.replace(/\s+/g, ' '));
  return out;
}

/**
 * Overlap coefficient rather than Jaccard: one analysis writes two sentences and
 * another writes six about the same defect, and Jaccard punishes that length gap
 * hard enough that the two never group.
 */
function similarity(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const term of smaller) if (larger.has(term)) shared += 1;
  return shared / smaller.size;
}

/**
 * How much of the smaller finding's vocabulary must appear in the other for the two
 * to be called the same problem. Tuned against a real 8-model run: at this value the
 * three runs that reported the invitation id-vs-name defect collapse into one row,
 * while the four distinct defects that all live in `feature-organizations/index.md`
 * stay apart. Lower and unrelated findings in one file merge; higher and the same
 * finding splits once two analyses word it differently.
 */
const SAME_ISSUE_THRESHOLD = 0.45;

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
  /** Groups in creation order, each carrying the vocabulary of everything folded in. */
  const groups: Array<AggregatedIssue & { terms: Set<string> }> = [];

  for (const result of results) {
    const recs = result.recommendations as { recommendations?: Record<string, unknown>[] } | undefined;
    const list = recs?.recommendations;
    if (!Array.isArray(list)) continue;

    const model = String(result.model ?? '');
    const evalId = String(result.eval_id ?? '');

    // A run reporting the same issue twice must count once, or a chatty analysis
    // outranks a repeat across models.
    const countedInThisRun = new Set<AggregatedIssue>();

    for (const rec of list) {
      const category = String(rec.category ?? 'other');
      const rootCause = String(rec.root_cause ?? 'unspecified');
      const context = String(rec.context ?? '');
      const issue = rec.issue ? String(rec.issue) : '';
      const terms = signature(`${issue} ${context}`);

      // Category and root cause are closed vocabularies, so they gate the match;
      // within a gate, the finding's own wording decides. Keying on `context`
      // instead — the earlier approach — grouped by the file and section a finding
      // pointed at, which merged every unrelated defect in one section into a
      // single row while splitting one defect two analyses filed under slightly
      // different section names.
      let group: (AggregatedIssue & { terms: Set<string> }) | undefined;
      let best = 0;
      for (const candidate of groups) {
        if (candidate.category !== category || candidate.root_cause !== rootCause) continue;
        const score = similarity(terms, candidate.terms);
        // Strictly greater keeps the earliest-created group when two tie, so the
        // output does not depend on which score file the reporter read first.
        if (score >= SAME_ISSUE_THRESHOLD && score > best) {
          best = score;
          group = candidate;
        }
      }

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
          terms: new Set(),
        };
        groups.push(group);
      }

      for (const term of terms) group.terms.add(term);

      if (!countedInThisRun.has(group)) {
        countedInThisRun.add(group);
        group.run_count += 1;
        pushUnique(group.models, model);
        pushUnique(group.evals, evalId);
      }

      const severity = String(rec.severity ?? 'low');
      if ((SEVERITY_RANK[severity] ?? 0) > (SEVERITY_RANK[group.severity] ?? 0)) {
        group.severity = severity as AggregatedIssue['severity'];
      }
      pushUnique(group.issues, issue || undefined);
      pushUnique(group.suggestions, rec.suggestion ? String(rec.suggestion) : undefined);
    }
  }

  const byLengthDesc = (a: string, b: string): number => b.length - a.length;

  return groups
    .map(({ terms: _terms, ...group }) => ({
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
