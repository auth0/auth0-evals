/**
 * Grader executor: matches
 *
 * Checks that a regex pattern matches in workspace files and/or the agent's
 * final reply, depending on the grader's `source` option.
 */

import type { GraderDef, GraderResult } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';

export const matchesExecutor: GraderExecutor = {
  kind: 'matches',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    const pattern = def.pattern!;
    let passed: boolean;
    let detail: string;
    try {
      // Case-insensitive by default; honor caseSensitive to match the other
      // text-search executors (contains/notContains). Always multiline.
      const flags = def.caseSensitive === true ? 'm' : 'im';
      const re = new RegExp(pattern, flags);
      const source = def.source ?? 'files';

      const checkFiles = source === 'files' || source === 'both';
      const checkResponse = source === 'response' || source === 'both';

      const inFiles = checkFiles ? re.test(ctx.combinedText) : false;
      const inAgent = checkResponse && ctx.agentText.length > 0 ? re.test(ctx.agentText) : false;

      passed = inFiles || inAgent;
      const matchedIn = inAgent && !inFiles ? 'agent reply' : 'written files';
      const searchScope =
        source === 'files' ? 'written files' : source === 'response' ? 'agent reply' : 'written files or agent reply';
      detail = `/${pattern}/ ${passed ? `matched in ${matchedIn}` : `NOT matched in ${searchScope}`}`;
    } catch (e) {
      passed = false;
      detail = `/(invalid regex: ${e})/ NOT matched`;
    }
    return { name: def.name, kind: def.kind, passed, detail, level: def.level };
  },
};
