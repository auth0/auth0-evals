import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('create_web_app', 'No hallucinated create_web_app tool name', GraderLevel.L2),
    notContains('register_client', 'No hallucinated register_client tool name', GraderLevel.L2),
    calledTool('auth0_create_application', 'Called auth0_create_application to create the Customer Portal', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Created application with regular_web app_type',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application').some(
          (tc) => tc.args['app_type'] === 'regular_web',
        ),
    },
    {
      kind: 'event',
      name: 'Created application with correct callback URL',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application').some((tc) => {
          const callbacks = tc.args['callbacks'] as string[] | undefined;
          return Array.isArray(callbacks) && callbacks.includes('https://portal.example.com/callback');
        }),
    },
    {
      kind: 'event',
      name: 'Created application with correct logout URL',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_create_application').some((tc) => {
          const logoutUrls = tc.args['allowed_logout_urls'] as string[] | undefined;
          return Array.isArray(logoutUrls) && logoutUrls.includes('https://portal.example.com');
        }),
    },
  ];
}
