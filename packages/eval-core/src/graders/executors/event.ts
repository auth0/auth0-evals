/**
 * Grader executor: event
 *
 * Evaluates event-based graders that inspect the agent's tool call trace.
 */

import type { GraderDef, GraderResult } from '@a0/eval-graders';
import type { GraderContext, GraderExecutor } from './types.js';

export const eventExecutor: GraderExecutor = {
  kind: 'event',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    if (!def.predicate) {
      return {
        name: def.name,
        kind: def.kind,
        passed: false,
        detail: 'Event grader missing predicate function',
        level: def.level,
      };
    }

    if (!ctx.toolCalls) {
      return {
        name: def.name,
        kind: def.kind,
        passed: false,
        detail: 'No tool calls available (baseline mode?)',
        level: def.level,
      };
    }

    const passed = def.predicate(ctx.toolCalls);
    return {
      name: def.name,
      kind: def.kind,
      passed,
      detail: passed ? 'Event condition met' : 'Event condition NOT met',
      level: def.level,
    };
  },
};
