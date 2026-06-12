/**
 * Eval definition types shared across the framework.
 *
 * The loader function that populates these types lives in the app layer
 * (`apps/auth0-evals/src/runners/loader.ts`); only the interfaces are
 * shared so runners and skills strategies can reference them.
 */

import type { GraderDef } from '@a0/eval-graders';
export type { GraderDef } from '@a0/eval-graders';

export interface EvalDefinition {
  id: string;
  name: string;
  category: string;
  path: string;
  baselineSystemPrompt: string;
  userPrompt: string;
  graders: GraderDef[];
  scaffold: Record<string, string>;
  setupCommand?: string;
  /** Command that starts the built app for runtime grading (e.g. "npm run dev"). */
  serveCommand?: string;
  /** Port the served app listens on (e.g. 5173). */
  servePort?: number;
  /** Raw `runtime_swap` frontmatter string: "fake=$ENV, fake2=$ENV2". */
  runtimeSwap?: string;
  skills: string[];
  metadata: Record<string, string>;
}
