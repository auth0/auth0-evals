/**
 * Grader factory functions.
 *
 * Each function creates a GraderDef descriptor. The actual evaluation
 * logic lives in runner.ts (runGraders).
 */

import type { GraderLevel, GraderDef, GraderOptions } from './types.js';

export function contains(
  needle: string,
  description?: string,
  level?: GraderLevel,
  options: GraderOptions = {},
): GraderDef {
  return {
    kind: 'contains',
    needle,
    name: description ?? `contains '${needle}'`,
    level,
    caseSensitive: options.caseSensitive ?? true,
  };
}

export function notContains(
  needle: string,
  description?: string,
  level?: GraderLevel,
  options: GraderOptions = {},
): GraderDef {
  return {
    kind: 'not_contains',
    needle,
    name: description ?? `not_contains '${needle}'`,
    level,
    caseSensitive: options.caseSensitive ?? true,
  };
}

export function matches(pattern: string, description?: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'matches',
    pattern,
    name: description ?? `matches /${pattern}/`,
    level,
  };
}

export function notContainsInSource(
  needle: string,
  description?: string,
  level?: GraderLevel,
  options: GraderOptions = {},
): GraderDef {
  return {
    kind: 'not_contains_in_source',
    needle,
    name: description ?? `not_contains_in_source '${needle}'`,
    level,
    caseSensitive: options.caseSensitive ?? true,
  };
}

export function judge(question: string, framework?: string, level?: GraderLevel): GraderDef {
  return {
    kind: 'judge',
    question,
    framework,
    name: question,
    level,
  };
}
