/**
 * Grader executor: compile
 *
 * Evaluates the result of running the eval's compile_command against the
 * workspace after the agent finishes. The framework runs the command and
 * populates ctx.compileResult before grading.
 */

import type { GraderDef, GraderResult } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';

const MAX_OUTPUT_TAIL = 500;

export const compileExecutor: GraderExecutor = {
  kind: 'compile',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    const result = ctx.compileResult;
    if (result === undefined) {
      return {
        name: def.name,
        kind: def.kind,
        passed: false,
        detail: 'compile was not run (no compile_command declared for this eval)',
        level: def.level,
      };
    }

    if (result.ok) {
      return {
        name: def.name,
        kind: def.kind,
        passed: true,
        detail: `compile_command '${result.command}' succeeded`,
        level: def.level,
      };
    }

    const tail = result.output.slice(-MAX_OUTPUT_TAIL);
    const cause = result.signal ? `signal ${result.signal}` : `exit code ${result.exitCode}`;
    return {
      name: def.name,
      kind: def.kind,
      passed: false,
      detail: `compile_command '${result.command}' failed (${cause}): ${tail}`,
      level: def.level,
    };
  },
};
