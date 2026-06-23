import { calledTool, notContains, contains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef } from '@a0/eval-graders';

export function defineGraders(): GraderDef[] {
  return [
    notContains('get_clients', 'No hallucinated get_clients tool name', GraderLevel.L2),
    notContains('list_clients', 'No hallucinated list_clients tool name', GraderLevel.L2),
    calledTool('auth0_list_applications', 'Called auth0_list_applications to retrieve all apps', GraderLevel.L4),
    contains('non_interactive', 'Response identifies M2M (non_interactive) app type', GraderLevel.L5),
    contains('Warehouse Bot', 'Response mentions Warehouse Bot (known M2M app)', GraderLevel.L5),
  ];
}
