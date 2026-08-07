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
  skills: string[];
  /**
   * Absolute path to the eval's `http-routes/` directory when present. Signals
   * that this eval drives the real auth0 CLI against a mock Management API: the
   * run lifecycle starts a mock HTTPS server seeded from these route manifests
   * and points the CLI at it. Undefined for evals that don't mock the CLI.
   */
  httpRoutesDir?: string;
  metadata: Record<string, string>;
}
