import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

const nodesContainKey = (nodes: unknown, key: string): boolean => {
  if (!Array.isArray(nodes)) return false;
  const haystack = JSON.stringify(nodes).toLowerCase();
  return haystack.includes(key.toLowerCase());
};

export function defineGraders(): GraderDef[] {
  return [
    // ── L2: No hallucinated tool names ────────────────────────────────────────
    notContains('create_progressive_profile', 'No hallucinated create_progressive_profile tool name', GraderLevel.L2),
    notContains('create_custom_form', 'No hallucinated create_custom_form tool name', GraderLevel.L2),

    // ── L4: Called the right tool ─────────────────────────────────────────────
    calledTool('auth0_create_form', 'Called auth0_create_form to create the form', GraderLevel.L4),

    // ── L5: Correct parameters ────────────────────────────────────────────────
    {
      kind: 'event',
      name: 'Created form with the correct name "Collect Work Info"',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_form').some((tc) => tc.args['name'] === 'Collect Work Info'),
    },
    {
      kind: 'event',
      name: 'Form nodes include job_title field',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_form').some((tc) => nodesContainKey(tc.args['nodes'], 'job_title')),
    },
    {
      kind: 'event',
      name: 'Form nodes include company field',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_form').some((tc) => nodesContainKey(tc.args['nodes'], 'company')),
    },
  ];
}
