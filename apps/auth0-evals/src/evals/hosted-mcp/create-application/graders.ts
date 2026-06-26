import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

// Returns successful MCP calls that match the given tool name substring.
const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    // ── L2: Did not hallucinate wrong tool names ──────────────────────────────
    notContains('create_client', 'No hallucinated create_client tool name', GraderLevel.L2),
    notContains('create_app', 'No hallucinated create_app tool name', GraderLevel.L2),
    notContains('register_application', 'No hallucinated register_application tool name', GraderLevel.L2),

    // ── L4: Called the right tool ─────────────────────────────────────────────
    calledTool('auth0_create_application', 'Called the auth0_create_application MCP tool', GraderLevel.L4),

    // ── L5: Correct parameters ────────────────────────────────────────────────
    {
      kind: 'event',
      name: 'Created application with app_type set to spa',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_application').some((tc) => tc.args['app_type'] === 'spa'),
    },
    {
      kind: 'event',
      name: 'Created application with the correct name "My Web App"',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_application').some((tc) => tc.args['name'] === 'My Web App'),
    },
  ];
}
