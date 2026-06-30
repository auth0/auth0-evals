import { calledTool, notContains, contains, GraderLevel } from '@a0/eval-graders';
import type { GraderDef } from '@a0/eval-graders';

export function defineGraders(): GraderDef[] {
  return [
    notContains('list_clients', 'No hallucinated list_clients tool name', GraderLevel.L2),
    notContains('get_oidc_settings', 'No hallucinated get_oidc_settings tool name', GraderLevel.L2),
    calledTool('auth0_list_applications', 'Called auth0_list_applications to retrieve all apps', GraderLevel.L4),
    contains('oidc_conformant', 'Response references oidc_conformant field', GraderLevel.L5),
    contains('enabled', 'Response includes list of apps with OIDC conformance enabled', GraderLevel.L5),
    contains('disabled', 'Response includes list of apps with OIDC conformance disabled', GraderLevel.L5),
  ];
}
