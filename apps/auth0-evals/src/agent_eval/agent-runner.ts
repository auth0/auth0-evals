/**
 * Re-export AgentRunner interface and registry from @a0/eval.
 *
 * All definitions have been moved to the @a0/eval package. This file
 * re-exports them so existing imports within the app layer continue to work.
 */

export type { AgentRunner, RunParams, RunResult } from '@a0/eval';
export { registerRunner, getRunner } from '@a0/eval';
