/**
 * Grading-level sets that control which grader levels run per execution mode.
 *
 * These are mode-dependent policy constants — baseline runs fewer checks than
 * agent, and agent+MCP enables the full suite including version correctness.
 */

import { GraderLevel } from '@a0/evals-graders';

/** Baseline mode: L1-L3 — presence, hallucination, security. */
export const BASELINE_LEVELS = new Set([GraderLevel.L1, GraderLevel.L2, GraderLevel.L3]);

/** Agent without MCP: L1-L4. No version-correctness without docs access. */
export const AGENT_LEVELS = new Set([GraderLevel.L1, GraderLevel.L2, GraderLevel.L3, GraderLevel.L4]);

/** Agent with MCP: L1-L5. Model has docs access, so version drift is a real failure. */
export const AGENT_MCP_LEVELS = new Set([
  GraderLevel.L1,
  GraderLevel.L2,
  GraderLevel.L3,
  GraderLevel.L4,
  GraderLevel.L5,
]);
