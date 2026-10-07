/**
 * Grader executor: tenant_state
 *
 * Evaluates a predicate over the tenant snapshots the eval's fixture took
 * before and after the agent ran. The snapshots never leave memory; only the
 * predicate's pass/fail and its optional reason reach the result.
 */

import type { GraderDef, GraderResult } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';

export const tenantStateExecutor: GraderExecutor = {
  kind: 'tenant_state',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    const fail = (detail: string): GraderResult => ({
      name: def.name,
      kind: def.kind,
      passed: false,
      detail,
      level: def.level,
    });

    if (!def.statePredicate) return fail('tenant_state grader missing predicate function');
    if (ctx.fixtureState === undefined) {
      return fail('No tenant state available (eval has no fixture.ts with a snapshot hook?)');
    }

    let outcome: boolean | string;
    try {
      outcome = def.statePredicate(ctx.fixtureState);
    } catch {
      // An error message (e.g. from assert.deepStrictEqual) can quote snapshot values, which must not be persisted.
      return fail('Tenant state predicate threw an error');
    }
    if (outcome === true) {
      return { name: def.name, kind: def.kind, passed: true, detail: 'Tenant state condition met', level: def.level };
    }
    return fail(typeof outcome === 'string' && outcome ? outcome : 'Tenant state condition NOT met');
  },
};
