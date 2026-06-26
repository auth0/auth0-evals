import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

export function defineGraders(): GraderDef[] {
  return [
    notContains('list_grants', 'No hallucinated list_grants tool name', GraderLevel.L2),
    notContains('get_client_grants', 'No hallucinated get_client_grants tool name', GraderLevel.L2),
    calledTool('auth0_list_applications', 'Called auth0_list_applications to identify M2M apps', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Response identifies M2M (non_interactive) apps',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        toolCalls
          .filter((tc) => !tc.causedError && tc.name.toLowerCase().includes('auth0_list_applications'))
          .some((tc) => typeof tc.result === 'string' && tc.result.includes('non_interactive')),
    },
    {
      kind: 'event',
      name: 'Response includes Warehouse Bot (known M2M app) in summary',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        toolCalls
          .filter((tc) => !tc.causedError && tc.name.toLowerCase().includes('auth0_list_applications'))
          .some((tc) => typeof tc.result === 'string' && tc.result.includes('Warehouse Bot')),
    },
    {
      kind: 'event',
      name: 'Response references Inventory Service API in grant summary',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        toolCalls
          .filter((tc) => !tc.causedError)
          .some((tc) => typeof tc.result === 'string' && tc.result.includes('Inventory Service')),
    },
  ];
}
