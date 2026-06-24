import { calledTool, notContains, contains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef } from '@a0/eval-graders';

export function defineGraders(): GraderDef[] {
  return [
    notContains('list_grants', 'No hallucinated list_grants tool name', GraderLevel.L2),
    notContains('get_client_grants', 'No hallucinated get_client_grants tool name', GraderLevel.L2),
    calledTool('auth0_list_applications', 'Called auth0_list_applications to identify M2M apps', GraderLevel.L4),
    contains('non_interactive', 'Response identifies M2M (non_interactive) apps', GraderLevel.L5),
    contains('Warehouse Bot', 'Response includes Warehouse Bot (known M2M app) in summary', GraderLevel.L5),
    contains('Inventory Service', 'Response references Inventory Service API in grant summary', GraderLevel.L5),
  ];
}
