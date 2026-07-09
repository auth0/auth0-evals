import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('create_action_version', 'No hallucinated create_action_version tool name', GraderLevel.L2),
    notContains('publish_action', 'No hallucinated publish_action tool name', GraderLevel.L2),
    calledTool('auth0_create_action', 'Called auth0_create_action to create the Enrich Token action', GraderLevel.L4),
    calledTool('auth0_update_action', 'Called auth0_update_action to update the action code', GraderLevel.L4),
    calledTool('auth0_deploy_action', 'Called auth0_deploy_action to deploy the action', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Actions were called in correct order: create → update → deploy',
      level: GraderLevel.L4,
      predicate: (toolCalls: EventToolCall[]) => {
        const createIdx = toolCalls.findIndex((tc) => !tc.causedError && tc.name.toLowerCase().includes('auth0_create_action'));
        const updateIdx = toolCalls.findIndex((tc) => !tc.causedError && tc.name.toLowerCase().includes('auth0_update_action'));
        const deployIdx = toolCalls.findIndex((tc) => !tc.causedError && tc.name.toLowerCase().includes('auth0_deploy_action'));
        return createIdx !== -1 && updateIdx > createIdx && deployIdx > updateIdx;
      },
    },
    {
      kind: 'event',
      name: 'Created action with post-login trigger',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_action').some((tc) => {
          const triggers = tc.args['supported_triggers'] as Array<{ id: string }> | undefined;
          return Array.isArray(triggers) && triggers.some((t) => t.id === 'post-login');
        }),
    },
    {
      kind: 'event',
      name: 'Updated code includes event.user.email claim',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_action').some((tc) => {
          const code = tc.args['code'] as string | undefined;
          return typeof code === 'string' && code.includes('event.user.email');
        }),
    },
    {
      kind: 'event',
      name: 'Updated code retains event.tenant.id claim',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_action').some((tc) => {
          const code = tc.args['code'] as string | undefined;
          return typeof code === 'string' && code.includes('event.tenant.id');
        }),
    },
  ];
}
