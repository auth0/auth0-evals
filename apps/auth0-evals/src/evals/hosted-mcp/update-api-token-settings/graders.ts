import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('update_api_settings', 'No hallucinated update_api_settings tool name', GraderLevel.L2),
    notContains('set_token_expiry', 'No hallucinated set_token_expiry tool name', GraderLevel.L2),
    calledTool('auth0_list_resource_servers', 'Called auth0_list_resource_servers to find Inventory Service', GraderLevel.L4),
    calledTool('auth0_update_resource_server', 'Called auth0_update_resource_server to update token settings', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Update sets token_lifetime to 1800',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_resource_server').some(
          (tc) => tc.args['token_lifetime'] === 1800,
        ),
    },
    {
      kind: 'event',
      name: 'Update enables allow_offline_access',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_resource_server').some(
          (tc) => tc.args['allow_offline_access'] === true,
        ),
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
