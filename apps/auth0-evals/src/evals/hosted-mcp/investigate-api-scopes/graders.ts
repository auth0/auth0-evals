import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('list_apis', 'No hallucinated list_apis tool name', GraderLevel.L2),
    notContains('update_api', 'No hallucinated update_api tool name', GraderLevel.L2),
    notContains('patch_resource_server', 'No hallucinated patch_resource_server tool name', GraderLevel.L2),
    calledTool(
      'auth0_list_resource_servers',
      'Called auth0_list_resource_servers to find the Inventory Service',
      GraderLevel.L4,
    ),
    calledTool(
      'auth0_update_resource_server',
      'Called auth0_update_resource_server to add the new scope',
      GraderLevel.L4,
    ),
    {
      kind: 'event',
      name: 'Update includes the new write:inventory scope',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_resource_server').some((tc) => {
          const scopes = tc.args['scopes'] as Array<{ value: string }> | undefined;
          return Array.isArray(scopes) && scopes.some((s) => s.value === 'write:inventory');
        }),
    },
    {
      kind: 'event',
      name: 'Update preserves the existing read:inventory scope',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_resource_server').some((tc) => {
          const scopes = tc.args['scopes'] as Array<{ value: string }> | undefined;
          return Array.isArray(scopes) && scopes.some((s) => s.value === 'read:inventory');
        }),
    },
    {
      kind: 'event',
      name: 'Update was called with a resource_server_id (looked up dynamically)',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_resource_server').some(
          (tc) => typeof tc.args['resource_server_id'] === 'string' && tc.args['resource_server_id'].length > 0,
        ),
    },
  ];
}
