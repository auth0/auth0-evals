import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('create_api', 'No hallucinated create_api tool name', GraderLevel.L2),
    notContains('create_spa', 'No hallucinated create_spa tool name', GraderLevel.L2),
    notContains('authorize_client', 'No hallucinated authorize_client tool name', GraderLevel.L2),
    calledTool('auth0_create_resource_server', 'Called auth0_create_resource_server to create Analytics Service', GraderLevel.L4),
    calledTool('auth0_create_application', 'Called auth0_create_application to create Analytics Dashboard SPA', GraderLevel.L4),
    calledTool('auth0_create_application_grant', 'Called auth0_create_application_grant to authorize the SPA', GraderLevel.L4),
    calledTool('auth0_update_application', 'Called auth0_update_application to add callback URL', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Created resource server with correct audience',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_resource_server').some(
          (tc) => tc.args['identifier'] === 'https://api.analytics.example.com',
        ),
    },
    {
      kind: 'event',
      name: 'Created SPA with app_type spa',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application').some(
          (tc) => tc.args['app_type'] === 'spa',
        ),
    },
    {
      kind: 'event',
      name: 'Application grant includes read:analytics scope',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application_grant').some((tc) => {
          const scope = tc.args['scope'] as string[] | undefined;
          return Array.isArray(scope) && scope.includes('read:analytics');
        }),
    },
    {
      kind: 'event',
      name: 'Callback URL update includes the new URL',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_application').some((tc) => {
          const callbacks = tc.args['callbacks'] as string[] | undefined;
          return Array.isArray(callbacks) && callbacks.includes('https://analytics.example.com/callback');
        }),
    },
  ];
}
