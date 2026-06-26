import { calledTool, notContains, contains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef } from '@a0/eval-graders';

export function defineGraders(): GraderDef[] {
  return [
    notContains('get_clients', 'No hallucinated get_clients tool name', GraderLevel.L2),
    notContains('list_clients', 'No hallucinated list_clients tool name', GraderLevel.L2),
    calledTool('auth0_list_applications', 'Called auth0_list_applications to retrieve all apps', GraderLevel.L4),
    contains('non_interactive', 'Response includes non_interactive app type in summary', GraderLevel.L5),
    contains('spa', 'Response includes spa app type in summary', GraderLevel.L5),
    contains('first', 'Response addresses first-party vs third-party distinction', GraderLevel.L5),
  ];
}
