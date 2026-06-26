import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('create_api', 'No hallucinated create_api tool name', GraderLevel.L2),
    notContains('create_m2m', 'No hallucinated create_m2m tool name', GraderLevel.L2),
    calledTool('auth0_create_resource_server', 'Called auth0_create_resource_server for Notifications Service', GraderLevel.L4),
    calledTool('auth0_create_application', 'Called auth0_create_application for Notifications Worker', GraderLevel.L4),
    calledTool('auth0_create_application_grant', 'Called auth0_create_application_grant to authorize the worker', GraderLevel.L4),
    calledTool('auth0_create_action', 'Called auth0_create_action for Log Notification Events', GraderLevel.L4),
    calledTool('auth0_deploy_action', 'Called auth0_deploy_action to deploy the action', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Created resource server with correct identifier',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_resource_server').some(
          (tc) => tc.args['identifier'] === 'https://api.notifications.example.com',
        ),
    },
    {
      kind: 'event',
      name: 'Created M2M application with non_interactive app type',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application').some(
          (tc) => tc.args['app_type'] === 'non_interactive',
        ),
    },
    {
      kind: 'event',
      name: 'Application grant includes send:notifications scope',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application_grant').some((tc) => {
          const scope = tc.args['scope'];
          if (Array.isArray(scope)) return scope.includes('send:notifications');
          if (typeof scope === 'string') return scope.split(/[\s,]+/).includes('send:notifications');
          return false;
        }),
    },
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
  ];
}
