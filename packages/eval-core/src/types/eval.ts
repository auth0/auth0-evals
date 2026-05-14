/**
 * Eval definition types shared across the framework.
 *
 * The loader function that populates these types lives in the app layer
 * (`apps/auth0-evals/src/runners/loader.ts`); only the interfaces are
 * shared so runners and skills strategies can reference them.
 */

export interface GraderDef {
  kind: string;
  name: string;
  needle?: string;
  pattern?: string;
  question?: string;
  framework?: string;
}

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
  skills: string[];
  metadata: Record<string, string>;
}
