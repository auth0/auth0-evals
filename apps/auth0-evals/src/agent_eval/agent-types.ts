/**
 * Re-export shared agent types and classification utilities from @a0/eval.
 *
 * All definitions have been moved to the @a0/eval package. This file
 * re-exports them so existing imports within the app layer continue to work.
 */

// Types
export type { FinishReason, ActionType, TurnMetric, ToolCallRecord, RunRecord } from '@a0/eval';
export type { ErrorCategory } from '@a0/eval';

// Classification utilities
export { classifyActionType, primaryArg, detectRetry, classifyErrorCategory } from '@a0/eval';
