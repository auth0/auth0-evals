/** @a0/eval-graders — Grader primitives and type definitions for eval frameworks. */

// Types
export { GraderLevel } from './types.js';
export type { GraderResult, GraderDef, GraderOptions } from './types.js';

// Grader factory functions
export { contains, notContains, notContainsInSource, matches, judge } from './primitives.js';
