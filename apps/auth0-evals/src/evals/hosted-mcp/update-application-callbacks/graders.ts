import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    // ── L2: Did not hallucinate tool names ────────────────────────────────────
    notContains('update_client', 'No hallucinated update_client tool name', GraderLevel.L2),
    notContains('patch_application', 'No hallucinated patch_application tool name', GraderLevel.L2),

    // ── L4: Called both tools in the right order (lookup then update) ─────────
    calledTool('auth0_list_applications', 'Called auth0_list_applications to find the app by name', GraderLevel.L4),
    calledTool('auth0_update_application', 'Called auth0_update_application to add the callback URL', GraderLevel.L4),

    // ── L5: Correct parameters ────────────────────────────────────────────────
    {
      kind: 'event',
      name: 'Update includes the new callback URL',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_update_application').some((tc) => {
          const callbacks = tc.args['callbacks'] as string[] | undefined;
          return Array.isArray(callbacks) && callbacks.includes('https://warehouse.example.com/callback');
        }),
    },
    {
      kind: 'event',
      name: 'Update was called with a client_id (looked up dynamically, not hardcoded)',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_update_application').some(
          (tc) => typeof tc.args['client_id'] === 'string' && tc.args['client_id'].length > 0,
        ),
    },
  ];
}
