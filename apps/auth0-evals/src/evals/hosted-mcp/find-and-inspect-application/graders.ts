import { calledTool, notContains, contains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('get_client', 'No hallucinated get_client tool name', GraderLevel.L2),
    notContains('find_client', 'No hallucinated find_client tool name', GraderLevel.L2),
    calledTool('auth0_list_applications', 'Called auth0_list_applications to find Warehouse Bot by name', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Called auth0_get_application to fetch full details',
      level: GraderLevel.L4,
      predicate: (toolCalls: EventToolCall[]) =>
        toolCalls.some(
          (tc) =>
            !tc.causedError &&
            (tc.name.toLowerCase().includes('auth0_get_application') ||
              tc.name.toLowerCase().includes('auth0_find_application_by_name')),
        ),
    },
    {
      kind: 'event',
      name: 'Fetched application using a client_id (looked up dynamically)',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_get_application').some(
          (tc) => typeof tc.args['client_id'] === 'string' && tc.args['client_id'].length > 0,
        ) ||
        mcpCalls(toolCalls, 'auth0_find_application_by_name').some(
          (tc) => typeof tc.args['name'] === 'string' && tc.args['name'].length > 0,
        ),
    },
    contains('non_interactive', 'Response correctly identifies app type as non_interactive (M2M)', GraderLevel.L5),
  ];
}
