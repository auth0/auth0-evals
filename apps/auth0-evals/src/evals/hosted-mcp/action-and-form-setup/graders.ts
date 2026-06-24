import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('create_redirect_action', 'No hallucinated create_redirect_action tool name', GraderLevel.L2),
    notContains('create_profile_form', 'No hallucinated create_profile_form tool name', GraderLevel.L2),
    calledTool('auth0_create_action', 'Called auth0_create_action to create Trigger Profile Collection', GraderLevel.L4),
    calledTool('auth0_deploy_action', 'Called auth0_deploy_action to deploy the action', GraderLevel.L4),
    calledTool('auth0_create_form', 'Called auth0_create_form to create Profile Collection Form', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Action created with post-login trigger',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_action').some((tc) => {
          const triggers = tc.args['supported_triggers'] as Array<{ id: string }> | undefined;
          return Array.isArray(triggers) && triggers.some((t) => t.id === 'post-login');
        }),
    },
    {
      kind: 'event',
      name: 'Form includes department field',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_form').some((tc) => {
          const nodes = tc.args['nodes'] as Array<{ field_key?: string }> | undefined;
          return Array.isArray(nodes) && nodes.some((n) => n.field_key === 'department');
        }),
    },
    {
      kind: 'event',
      name: 'Form includes location field',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_form').some((tc) => {
          const nodes = tc.args['nodes'] as Array<{ field_key?: string }> | undefined;
          return Array.isArray(nodes) && nodes.some((n) => n.field_key === 'location');
        }),
    },
  ];
}
