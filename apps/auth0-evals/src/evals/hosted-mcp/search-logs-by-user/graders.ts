import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('search_user_logs', 'No hallucinated search_user_logs tool name', GraderLevel.L2),
    notContains('get_user_events', 'No hallucinated get_user_events tool name', GraderLevel.L2),
    calledTool('auth0_list_logs', 'Called auth0_list_logs to search for user events', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Filtered logs by user email in query',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_list_logs').some((tc) => {
          const q = tc.args['q'] as string | undefined;
          return typeof q === 'string' && q.includes('testuser@example.com');
        }),
    },
    {
      kind: 'event',
      name: 'Used take parameter to bound results',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_list_logs').some(
          (tc) => typeof tc.args['take'] === 'number' && tc.args['take'] > 0,
        ),
    },
  ];
}
