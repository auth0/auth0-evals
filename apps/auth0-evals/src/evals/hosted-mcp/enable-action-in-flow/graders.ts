import { calledTool, notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('list_actions', 'No hallucinated list_actions tool name', GraderLevel.L2),
    notContains('deploy_action', 'No hallucinated deploy_action tool name', GraderLevel.L2),
    calledTool('auth0_list_actions', 'Called auth0_list_actions to discover existing actions', GraderLevel.L4),
    {
      kind: 'event',
      name: 'Listed actions before deciding whether to deploy',
      level: GraderLevel.L4,
      predicate: (toolCalls: EventToolCall[]) => {
        const listIdx = toolCalls.findIndex((tc) => tc.name.toLowerCase().includes('auth0_list_actions'));
        const deployIdx = toolCalls.findIndex((tc) => tc.name.toLowerCase().includes('auth0_deploy_action'));
        return listIdx !== -1 && (deployIdx === -1 || listIdx < deployIdx);
      },
    },
    {
      kind: 'event',
      name: 'Deployed with a valid action_id (looked up dynamically)',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_deploy_action').some(
          (tc) => typeof tc.args['action_id'] === 'string' && tc.args['action_id'].length > 0,
        ),
    },
  ];
}
