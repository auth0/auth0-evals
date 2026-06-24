import { calledTool, notContains, contains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('rename_app', 'No hallucinated rename_app tool name', GraderLevel.L2),
    notContains('patch_client', 'No hallucinated patch_client tool name', GraderLevel.L2),
    calledTool('auth0_list_applications', 'Called auth0_list_applications to find Analytics Dashboard', GraderLevel.L4),
    calledTool('auth0_update_application', 'Called auth0_update_application to rename the app', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Update sets name to Analytics Hub',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_application').some(
          (tc) => tc.args['name'] === 'Analytics Hub',
        ),
    },
    {
      kind: 'event',
      name: 'Update was called with a client_id (looked up dynamically)',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_application').some(
          (tc) => typeof tc.args['client_id'] === 'string' && tc.args['client_id'].length > 0,
        ),
    },
    contains('Analytics Hub', 'Response confirms the new name Analytics Hub', GraderLevel.L5),
  ];
}
