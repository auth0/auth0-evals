/** @a0/eval-graders — Grader primitives and type definitions for eval frameworks. */

// Types
export { GraderLevel, TENANT_CONFIG_INSTRUCTIONS } from './types.js';
export type {
  GraderResult,
  GraderDef,
  GraderOptions,
  EventToolCall,
  EventGraderLevel,
  CompileResult,
  TenantConfigMethod,
} from './types.js';
export type { JudgeOptions } from './primitives.js';

// Grader factory functions
export {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  ranCommand,
  ranCommandOneOf,
  ranCommandsInOrder,
  wroteFile,
  compiles,
} from './primitives.js';
