import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    // ── L2: Did not hallucinate data or make up error types ───────────────────
    notContains('I cannot access', 'Did not refuse to check logs', GraderLevel.L2),
    notContains("I don't have access", 'Did not claim lack of access', GraderLevel.L2),

    // ── L4: Actually queried the logs ─────────────────────────────────────────
    calledTool('auth0_list_logs', 'Called auth0_list_logs to retrieve tenant logs', GraderLevel.L4),

    // ── L5: Used a failure-focused query and reported concrete findings ───────
    {
      kind: 'event',
      name: 'Queried logs with a failure filter (q parameter)',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_list_logs').some(
          (tc) => typeof tc.args['q'] === 'string' && tc.args['q'].length > 0,
        ),
    },
    {
      kind: 'event',
      name: 'Retrieved a meaningful number of log entries (take >= 10)',
      level: GraderLevel.L5,
      predicate: (toolCalls) =>
        mcpCalls(toolCalls, 'auth0_list_logs').some(
          (tc) => typeof tc.args['take'] !== 'number' || (tc.args['take'] as number) >= 10,
        ),
    },
  ];
}
