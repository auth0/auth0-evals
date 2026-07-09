import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('add_scope', 'No hallucinated add_scope tool name', GraderLevel.L2),
    notContains('patch_resource_server', 'No hallucinated patch_resource_server tool name', GraderLevel.L2),
    calledTool('auth0_list_resource_servers', 'Called auth0_list_resource_servers to find Inventory Service', GraderLevel.L4),
    calledTool('auth0_update_resource_server', 'Called auth0_update_resource_server to add new scopes', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Update includes write:inventory scope',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_resource_server').some((tc) => {
          const scopes = tc.args['scopes'] as Array<{ value: string }> | undefined;
          return Array.isArray(scopes) && scopes.some((s) => s.value === 'write:inventory');
        }),
    },
    {
      kind: 'event',
      name: 'Update includes delete:inventory scope',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_resource_server').some((tc) => {
          const scopes = tc.args['scopes'] as Array<{ value: string }> | undefined;
          return Array.isArray(scopes) && scopes.some((s) => s.value === 'delete:inventory');
        }),
    },
    {
      kind: 'event',
      name: 'Update includes admin:inventory scope',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_resource_server').some((tc) => {
          const scopes = tc.args['scopes'] as Array<{ value: string }> | undefined;
          return Array.isArray(scopes) && scopes.some((s) => s.value === 'admin:inventory');
        }),
    },
    {
      kind: 'event',
      name: 'Update preserves existing read:inventory scope',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_resource_server').some((tc) => {
          const scopes = tc.args['scopes'] as Array<{ value: string }> | undefined;
          return Array.isArray(scopes) && scopes.some((s) => s.value === 'read:inventory');
        }),
    },
  ];
}
