import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    // ── L2: No hallucinated trigger IDs ───────────────────────────────────────
    notContains('post_login', 'No hallucinated post_login trigger ID (correct is post-login)', GraderLevel.L2),
    notContains('postLogin', 'No hallucinated postLogin trigger ID (correct is post-login)', GraderLevel.L2),

    // ── L4: Called both required tools ────────────────────────────────────────
    calledTool('auth0_create_action', 'Called auth0_create_action to create the action', GraderLevel.L4),
    calledTool('auth0_deploy_action', 'Called auth0_deploy_action to deploy the action', GraderLevel.L4),

    // ── L5: Correct parameters ────────────────────────────────────────────────
    {
      kind: 'event',
      name: 'Created action with correct post-login trigger ID',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_action').some((tc) => {
          const triggers = tc.args['supported_triggers'] as Array<{ id: string }> | undefined;
          return Array.isArray(triggers) && triggers.some((t) => t.id === 'post-login');
        }),
    },
    {
      kind: 'event',
      name: 'Action code references event.authorization.roles',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_action').some(
          (tc) => typeof tc.args['code'] === 'string' && tc.args['code'].includes('event.authorization.roles'),
        ),
    },
    {
      kind: 'event',
      name: 'Action code sets a roles claim on the ID token',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_create_action').some(
          (tc) =>
            typeof tc.args['code'] === 'string' &&
            tc.args['code'].includes('idToken') &&
            tc.args['code'].includes('roles'),
        ),
    },
  ];
}
