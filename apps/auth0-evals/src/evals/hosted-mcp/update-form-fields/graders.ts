import { notContains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef, EventToolCall } from '@a0/eval-graders';

const mcpCalls = (toolCalls: EventToolCall[], name: string) =>
  toolCalls.filter((tc) => !tc.causedError && tc.name.toLowerCase().includes(name.toLowerCase()));

export function defineGraders(): GraderDef[] {
  return [
    notContains('patch_form', 'No hallucinated patch_form tool name', GraderLevel.L2),
    notContains('update_form_field', 'No hallucinated update_form_field tool name', GraderLevel.L2),
    {
      kind: 'event',
      name: 'Called auth0_list_forms or auth0_get_form to find the Collect Work Info form',
      level: GraderLevel.L4,
      predicate: (toolCalls: EventToolCall[]) =>
        toolCalls.some(
          (tc) =>
            !tc.causedError &&
            (tc.name.toLowerCase().includes('auth0_list_forms') ||
              tc.name.toLowerCase().includes('auth0_get_form')),
        ),
    },
    {
      kind: 'event',
      name: 'Called auth0_update_form to add the new field',
      level: GraderLevel.L4,
      predicate: (toolCalls: EventToolCall[]) =>
        toolCalls.some((tc) => !tc.causedError && tc.name.toLowerCase().includes('auth0_update_form')),
    },
    {
      kind: 'event',
      name: 'Updated form includes phone_number field',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_form').some((tc) => {
          const nodes = tc.args['nodes'] as Array<{ field_key?: string }> | undefined;
          return Array.isArray(nodes) && nodes.some((n) => n.field_key === 'phone_number');
        }),
    },
    {
      kind: 'event',
      name: 'Updated form preserves existing job_title and company fields',
      level: GraderLevel.L5,
      predicate: (toolCalls: EventToolCall[]) =>
        mcpCalls(toolCalls, 'auth0_update_form').some((tc) => {
          const nodes = tc.args['nodes'] as Array<{ field_key?: string }> | undefined;
          if (!Array.isArray(nodes)) return false;
          const keys = nodes.map((n) => n.field_key);
          return keys.includes('job_title') && keys.includes('company');
        }),
    },
  ];
}
