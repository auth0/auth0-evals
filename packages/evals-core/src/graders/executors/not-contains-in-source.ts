/**
 * Grader executor: not_contains_in_source
 *
 * Checks that a needle substring is NOT present in source files,
 * while allowing it in config files (.env, .json, .yaml, etc.).
 */

import type { GraderDef, GraderResult } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';
import { NON_SOURCE_EXTS, NON_SOURCE_PREFIXES } from './text-search-utils.js';

export const notContainsInSourceExecutor: GraderExecutor = {
  kind: 'not_contains_in_source',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    const needle = def.needle!;
    const needleLower = needle.toLowerCase();
    let found = false;

    for (const [filePath, content] of Object.entries(ctx.files)) {
      const base = filePath.split('/').pop() ?? filePath;
      if (NON_SOURCE_EXTS.test(base) || NON_SOURCE_PREFIXES.test(base)) continue;
      const hit = (def.caseSensitive ?? true) ? content.includes(needle) : content.toLowerCase().includes(needleLower);
      if (hit) {
        found = true;
        break;
      }
    }

    return {
      name: def.name,
      kind: def.kind,
      passed: !found,
      detail: `'${needle}' ${!found ? 'NOT found in source files (good)' : 'FOUND in source files (bad)'}`,
      level: def.level,
    };
  },
};
