/**
 * Eval definition types shared across the framework.
 *
 * The loader function that populates these types lives in the app layer
 * (`apps/auth0-evals/src/runners/loader.ts`); only the interfaces are
 * shared so runners and skills strategies can reference them.
 */

import type { GraderDef } from '@a0/evals-graders';
export type { GraderDef } from '@a0/evals-graders';

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
  compileCommand?: string;
  /**
   * Live-environment the eval requests, from the `provision` frontmatter field
   * (e.g. `auth0-tenant`). The framework loader does not act on this itself; an
   * external runner reads it to provision the environment, and the value keys
   * into {@link FrameworkConfig.cliContext} to inject matching agent
   * context (see `writeAgentGuidance`).
   */
  provision?: string;
  skills: string[];
  metadata: Record<string, string>;
}
