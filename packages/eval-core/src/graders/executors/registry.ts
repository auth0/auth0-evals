/**
 * Grader executor registry.
 *
 * Maps grader kinds to executor instances. The registry is populated at module
 * load time with built-in executors and can be extended at runtime.
 */

import type { GraderDef, GraderResult } from '@a0/eval-graders';
import type { GraderContext, GraderExecutor } from './types.js';

const executors = new Map<string, GraderExecutor>();

/**
 * Register an executor for its declared kind.
 * Later registrations for the same kind overwrite earlier ones.
 */
export function registerExecutor(executor: GraderExecutor): void {
  executors.set(executor.kind, executor);
}

/** Retrieve the executor registered for a given kind, or undefined. */
export function getExecutor(kind: string): GraderExecutor | undefined {
  return executors.get(kind);
}

/** Execute a single grader using the registered executor for its kind. */
export async function executeGrader(def: GraderDef, context: GraderContext): Promise<GraderResult> {
  const executor = executors.get(def.kind);
  if (!executor) {
    return {
      name: def.name,
      kind: def.kind,
      passed: false,
      detail: `Unknown grader kind: ${def.kind}`,
      level: def.level,
    };
  }
  return executor.execute(def, context);
}
