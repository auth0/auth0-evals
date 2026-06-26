import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('create_mobile_app', 'No hallucinated create_mobile_app tool name', GraderLevel.L2),
    notContains('register_app', 'No hallucinated register_app tool name', GraderLevel.L2),
    calledTool('auth0_create_application', 'Called auth0_create_application to create the native app', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Created application with native app_type',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application').some(
          (tc) => tc.args['app_type'] === 'native',
        ),
    },
    {
      kind: 'event',
      name: 'Created application with correct callback URL',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application').some((tc) => {
          const callbacks = tc.args['callbacks'] as string[] | undefined;
          return Array.isArray(callbacks) && callbacks.includes('com.example.warehouse://callback');
        }),
    },
    {
      kind: 'event',
      name: 'Created application named Mobile Warehouse App',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application').some(
          (tc) => tc.args['name'] === 'Mobile Warehouse App',
        ),
    },
  ];
}
