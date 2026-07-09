import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('create_api', 'No hallucinated create_api tool name', GraderLevel.L2),
    notContains('get_api', 'No hallucinated get_api tool name', GraderLevel.L2),
    calledTool(
      'auth0_create_resource_server',
      'Called auth0_create_resource_server to create the Reporting Service API',
      GraderLevel.L4,
    ),
    {
      kind: 'event',
      name: 'Called auth0_get_resource_server or auth0_list_resource_servers to verify creation',
      level: GraderLevel.L4,
      predicate: (toolCalls: EventToolCall[]) => {
        const createIdx = toolCalls.findIndex((tc) =>
          tc.name.toLowerCase().includes('auth0_create_resource_server'),
        );
        const verifyIdx = toolCalls.findIndex(
          (tc) =>
            !tc.causedError &&
            (tc.name.toLowerCase().includes('auth0_get_resource_server') ||
              tc.name.toLowerCase().includes('auth0_list_resource_servers')),
        );
        return createIdx !== -1 && verifyIdx > createIdx;
      },
    },
    {
      kind: 'event',
      name: 'Created resource server with correct identifier',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_resource_server').some(
          (tc) => tc.args['identifier'] === 'https://api.reporting.example.com',
        ),
    },
    {
      kind: 'event',
      name: 'Created resource server with read:reports scope',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_resource_server').some((tc) => {
          const scopes = tc.args['scopes'] as Array<{ value: string }> | undefined;
          return Array.isArray(scopes) && scopes.some((s) => s.value === 'read:reports');
        }),
    },
  ];
}
