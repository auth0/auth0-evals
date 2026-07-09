import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('patch_action', 'No hallucinated patch_action tool name', GraderLevel.L2),
    notContains('update_action_code', 'No hallucinated update_action_code tool name', GraderLevel.L2),
    calledTool('auth0_list_actions', 'Called auth0_list_actions to find the action by name', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Called auth0_update_action or auth0_get_action to inspect/update the action',
      level: GraderLevel.L4,
      predicate: (toolCalls: EventToolCall[]) =>
        toolCalls.some(
          (tc) =>
            !tc.causedError &&
            (tc.name.toLowerCase().includes('auth0_update_action') ||
              tc.name.toLowerCase().includes('auth0_get_action')),
        ),
    },
    {
      kind: 'event',
      name: 'Updated action code includes event.authorization.permissions',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_action').some((tc) => {
          const code = tc.args['code'] as string | undefined;
          return typeof code === 'string' && code.includes('event.authorization.permissions');
        }),
    },
    {
      kind: 'event',
      name: 'Updated action code retains event.authorization.roles',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_action').some((tc) => {
          const code = tc.args['code'] as string | undefined;
          return typeof code === 'string' && code.includes('event.authorization.roles');
        }),
    },
    {
      kind: 'event',
      name: 'Update was called with a valid action_id (looked up dynamically)',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_action').some(
          (tc) => typeof tc.args['action_id'] === 'string' && tc.args['action_id'].length > 0,
        ),
    },
  ];
}
