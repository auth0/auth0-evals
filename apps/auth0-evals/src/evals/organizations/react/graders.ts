import { contains, notContains, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('organization', 'Passes the organization parameter for org-scoped login', GraderLevel.L1),
    contains('invitation', 'Handles the organization invitation parameter', GraderLevel.L1),
    contains('org_id', 'Reads the org_id claim to identify the logged-in organization', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2),
    notContains('useOrganization', 'No non-existent useOrganization hook (not in @auth0/auth0-react)', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in SPA (public client)', GraderLevel.L2),

    // ── L3: Security ───────────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens stored in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens stored in sessionStorage', GraderLevel.L3),

    // ── L4: Structural correctness ─────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    judge(
      'Does the code read the "invitation" and "organization" parameters from the URL query string ' +
        'and forward both to loginWithRedirect when they are present, so an invitation link is accepted?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code surface the organization the user logged into by reading the org_id claim ' +
        '(via user.org_id or getIdTokenClaims), rather than hardcoding or guessing it?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    judge(
      'Does the code pass the organization value inside an authorizationParams object ' +
        '(on Auth0Provider or loginWithRedirect) rather than as a top-level "organization" prop ' +
        'or a positional argument?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the React app — logging users ' +
        'into the specified organization, accepting organization invitation links via the invitation ' +
        'and organization query parameters, and identifying the logged-in organization from the org_id claim?',
    ),
  ];
}
