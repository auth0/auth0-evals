/**
 * Types for the post-scoring recommendations engine.
 */

/**
 * A single actionable recommendation produced by the analysis.
 *
 * `category` is deliberately wider than the skill. Offered only `skill`, `grader`,
 * `mcp` and `efficiency`, an analyst files everything as a skill gap — including a
 * CLI that has no subcommand for the job and a task prompt two models read two
 * different ways. Those are real defects with different owners, and folding them
 * into "document it harder" sends the fix to the wrong place.
 */
export interface Recommendation {
  /**
   * Which surface has to change.
   *
   * - `skill` — the Auth0 agent skill's own text.
   * - `grader` — one check in the eval's `graders.ts`.
   * - `eval` — the task definition: `PROMPT.md`, its scaffold, or its provisioning.
   * - `cli` — the `auth0` CLI itself: a missing subcommand, a misleading flag, an
   *   unhelpful error. Product feedback rather than something this repo can patch.
   * - `docs` — Auth0's published documentation.
   * - `mcp` — the Auth0 docs MCP server's tools or their output.
   * - `efficiency` — turns wasted with no defect behind them.
   */
  category: 'grader' | 'skill' | 'eval' | 'cli' | 'docs' | 'mcp' | 'efficiency';
  /** Impact level of the issue. */
  severity: 'high' | 'medium' | 'low';
  /** Description of the problem observed. */
  issue: string;
  /** Concrete suggestion for how to fix or improve. */
  suggestion: string;
  /** Optional context — grader name, skill name, tool name, file path, etc. */
  context?: string;
  /**
   * Where the fault lies.
   *
   * `skill` is the one worth acting on first: the skill was in the agent's context
   * the whole run, so a failure it was in a position to prevent is a defect in the
   * documentation, not in the model. `grader` means the agent was right and the
   * check is wrong; `eval` means the task itself was ambiguous or contradictory, so
   * neither the agent nor the skill could have got it right; `cli` means the tool
   * surface was the obstacle. Optional — older stored results and efficiency notes
   * omit it.
   */
  root_cause?: 'skill' | 'model' | 'grader' | 'eval' | 'cli' | 'environment';
  /** What the agent actually did, with the command or code that did it. */
  what_happened?: string;
  /** The correct behaviour, concretely. */
  what_should_have_happened?: string;
  /** Verbatim quote from the run trace, workspace, or skill text backing the finding. */
  evidence?: string;
}

/** Full recommendations output attached to an AgentJobResult. */
export interface Recommendations {
  /** Eval identifier this analysis was generated for. */
  eval_id: string;
  /** Model that was evaluated. */
  model: string;
  /** Tools that were enabled during the run. */
  tools: string[];
  /** Ordered list of recommendations (highest severity first). */
  recommendations: Recommendation[];
  /** 2-3 sentence executive summary of the analysis. */
  summary: string;
  /**
   * Why the analysis produced nothing, when it produced nothing.
   *
   * Present only on failure (proxy error, truncated or unparseable response). Without
   * it an empty list reads as "the run was clean" in the report, which is the opposite
   * of what a 500 means.
   */
  error?: string;
}
