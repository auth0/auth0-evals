/**
 * Types for the post-scoring recommendations engine.
 */

/** A single actionable recommendation produced by the analysis. */
export interface Recommendation {
  /** Which area this recommendation targets. */
  category: 'grader' | 'skill' | 'mcp' | 'efficiency';
  /** Impact level of the issue. */
  severity: 'high' | 'medium' | 'low';
  /** Description of the problem observed. */
  issue: string;
  /** Concrete suggestion for how to fix or improve. */
  suggestion: string;
  /** Optional context — grader name, skill name, tool name, file path, etc. */
  context?: string;
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
}
