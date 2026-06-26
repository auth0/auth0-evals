import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('check_grant', 'No hallucinated check_grant tool name', GraderLevel.L2),
    notContains('fix_config', 'No hallucinated fix_config tool name', GraderLevel.L2),
    calledTool('auth0_list_applications', 'Called auth0_list_applications to find Notifications Worker', GraderLevel.L4),
    calledTool('auth0_list_resource_servers', 'Called auth0_list_resource_servers to find Notifications Service', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Created application grant to fix missing access',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        toolCalls.some((tc) => !tc.causedError && tc.name.toLowerCase().includes('auth0_create_application_grant')),
    },
    {
      kind: 'event',
      name: 'Grant includes send:notifications scope',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application_grant').some((tc) => {
          const scope = tc.args['scope'] as string[] | undefined;
          return Array.isArray(scope) && scope.includes('send:notifications');
        }),
    },
  ];
}
