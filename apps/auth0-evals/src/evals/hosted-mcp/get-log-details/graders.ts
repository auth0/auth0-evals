import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('search_logs', 'No hallucinated search_logs tool name', GraderLevel.L2),
    notContains('get_event', 'No hallucinated get_event tool name', GraderLevel.L2),
    calledTool('auth0_list_logs', 'Called auth0_list_logs to find recent successful login events', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Filtered logs for successful login type (type:s)',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_list_logs').some((tc) => {
          const q = tc.args['q'] as string | undefined;
          return typeof q === 'string' && q.includes('type:s');
        }),
    },
    {
      kind: 'event',
      name: 'Fetched individual log event details after listing',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) => {
        const listIdx = toolCalls.findIndex((tc) => tc.name.toLowerCase().includes('auth0_list_logs'));
        const getIdx = toolCalls.findIndex(
          (tc, i) =>
            !tc.causedError &&
            tc.name.toLowerCase().includes('auth0_get_log') &&
            i > listIdx,
        );
        return listIdx !== -1 && getIdx !== -1;
      },
    },
  ];
}
