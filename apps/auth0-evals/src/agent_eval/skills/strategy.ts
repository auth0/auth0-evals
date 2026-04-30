/**
 * Re-exports skills strategy from @a0/eval.
 *
 * The canonical implementation lives in the package. This file exists so
 * app-layer runners and tests can import from the same relative path while
 * using the single shared singleton (no duplicate getFrameworkConfig issue).
 */

export {
  ensureCloned,
  copySkillsToWorkspace,
  augmentWithSkills,
  InjectSkillsStrategy,
  CopySkillsStrategy,
} from '@a0/eval';
export type { SkillsStrategy } from '@a0/eval';
