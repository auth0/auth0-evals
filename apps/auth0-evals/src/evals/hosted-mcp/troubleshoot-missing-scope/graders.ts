import { calledTool, notContains, contains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef } from '@a0/eval-graders';

export function defineGraders(): GraderDef[] {
  return [
    notContains('check_permissions', 'No hallucinated check_permissions tool name', GraderLevel.L2),
    notContains('get_grant', 'No hallucinated get_grant tool name', GraderLevel.L2),
    calledTool('auth0_list_resource_servers', 'Called auth0_list_resource_servers to inspect Inventory Service scopes', GraderLevel.L4),
    calledTool('auth0_list_applications', 'Called auth0_list_applications to find Warehouse Bot', GraderLevel.L4),
    contains('read:inventory', 'Response references the read:inventory scope in its analysis', GraderLevel.L5),
    contains('Warehouse Bot', 'Response references Warehouse Bot by name', GraderLevel.L5),
    contains('Inventory Service', 'Response references Inventory Service by name', GraderLevel.L5),
  ];
}
