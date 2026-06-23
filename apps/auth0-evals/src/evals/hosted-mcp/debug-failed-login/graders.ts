import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('get_logs', 'No hallucinated get_logs tool name', GraderLevel.L2),
    notContains('search_logs', 'No hallucinated search_logs tool name', GraderLevel.L2),
    calledTool('auth0_list_logs', 'Called auth0_list_logs to search for failed login events', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Filtered logs with a query targeting failure events',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_list_logs').some((tc) => {
          const q = tc.args['q'] as string | undefined;
          // Common failure type codes: f (failed login), fp (wrong password), fu (blocked), etc.
          return typeof q === 'string' && (q.includes('type:f') || q.includes('type:fp') || q.includes('type:fu') || q.toLowerCase().includes('fail'));
        }),
    },
    {
      kind: 'event',
      name: 'Used take parameter to limit log results',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_list_logs').some(
          (tc) => typeof tc.args['take'] === 'number' && tc.args['take'] > 0,
        ),
    },
  ];
}
