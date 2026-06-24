import { calledTool, notContains, contains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('get_forms', 'No hallucinated get_forms tool name', GraderLevel.L2),
    notContains('list_form', 'No hallucinated list_form tool name', GraderLevel.L2),
    {
      kind: 'event',
      name: 'Called auth0_list_forms to enumerate all forms',
      level: GraderLevel.L4,
      predicate: (toolCalls: EventToolCall[]) =>
        toolCalls.some((tc) => !tc.causedError && tc.name.toLowerCase().includes('auth0_list_forms')),
    },
    {
      kind: 'event',
      name: 'Called auth0_get_form to fetch Collect Work Info details',
      level: GraderLevel.L4,
      predicate: (toolCalls: EventToolCall[]) =>
        toolCalls.some((tc) => !tc.causedError && tc.name.toLowerCase().includes('auth0_get_form')),
    },
    {
      kind: 'event',
      name: 'Fetched form using a form_id (looked up dynamically)',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_get_form').some(
          (tc) => typeof tc.args['form_id'] === 'string' && tc.args['form_id'].length > 0,
        ),
    },
    contains('job_title', 'Response includes job_title field key', GraderLevel.L5),
    contains('company', 'Response includes company field key', GraderLevel.L5),
  ];
}
