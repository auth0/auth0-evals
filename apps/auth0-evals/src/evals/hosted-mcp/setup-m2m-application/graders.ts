import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    // ── L2: No hallucinated tool names ────────────────────────────────────────
    notContains('create_api', 'No hallucinated create_api tool name', GraderLevel.L2),
    notContains('create_m2m', 'No hallucinated create_m2m tool name', GraderLevel.L2),
    notContains('authorize_client', 'No hallucinated authorize_client tool name', GraderLevel.L2),

    // ── L4: Called all three required tools ───────────────────────────────────
    calledTool('auth0_create_resource_server', 'Called auth0_create_resource_server to create the API', GraderLevel.L4),
    calledTool('auth0_create_application', 'Called auth0_create_application to create the M2M app', GraderLevel.L4),
    calledTool(
      'auth0_create_application_grant',
      'Called auth0_create_application_grant to authorize the app',
      GraderLevel.L4,
    ),

    // ── L5: Correct parameters ────────────────────────────────────────────────
    {
      kind: 'event',
      name: 'Created resource server with correct identifier',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_resource_server').some(
          (tc) => tc.args['identifier'] === 'https://api.inventory.example.com',
        ),
    },
    {
      kind: 'event',
      name: 'Created resource server with read:inventory scope',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_resource_server').some((tc) => {
          const scopes = tc.args['scopes'] as Array<{ value: string }> | undefined;
          return Array.isArray(scopes) && scopes.some((s) => s.value === 'read:inventory');
        }),
    },
    {
      kind: 'event',
      name: 'Created M2M application with app_type non_interactive',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_application').some((tc) => tc.args['app_type'] === 'non_interactive'),
    },
    {
      kind: 'event',
      name: 'Created application grant with read:inventory scope',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_application_grant').some((tc) => {
          const scope = tc.args['scope'] as string[] | undefined;
          return Array.isArray(scope) && scope.includes('read:inventory');
        }),
    },
    {
      kind: 'event',
      name: 'Application grant targets the correct audience',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_application_grant').some(
          (tc) => tc.args['audience'] === 'https://api.inventory.example.com',
        ),
    },
  ];
}
