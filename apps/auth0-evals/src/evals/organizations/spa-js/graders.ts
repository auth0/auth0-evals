import { contains, notContains, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('organization', 'Passes the organization parameter for org-scoped login', GraderLevel.L1),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1),
    contains('invitation', 'Handles the organization invitation parameter', GraderLevel.L1),
    contains('org_id', 'Reads the org_id claim to identify the logged-in organization', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2),
    notContains('@auth0/auth0-react', 'No React SDK in a vanilla JS app', GraderLevel.L2),
    notContains(
      'useOrganization(',
      'No non-existent useOrganization hook (auth0-spa-js is not hook-based)',
      GraderLevel.L2,
    ),
    notContains('client_secret', 'No client_secret in SPA (public client)', GraderLevel.L2),

    // ── L3: Security ───────────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens stored in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens stored in sessionStorage', GraderLevel.L3),

    // ── L4: Structural correctness ─────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    matches(
      String.raw`authorizationParams[\s\S]{0,160}organization`,
      'Passes organization inside an authorizationParams object',
      GraderLevel.L4,
    ),
    judge(
      'Does the code read the "invitation" and "organization" parameters from the URL query string ' +
        'and forward them to loginWithRedirect (inside authorizationParams) when present? To pass, the ' +
        'invitation\'s own "organization" must be forwarded (overriding any default/configured org), and ' +
        'the code must NOT reject or block a valid invitation solely because its organization differs from ' +
        "the app's configured default org.",
      GraderLevel.L4,
    ),
    judge(
      'Does the code surface the organization the user logged into by reading the org_id claim ' +
        '(via the getUser() result, e.g. user.org_id, or getIdTokenClaims()), rather than hardcoding or guessing it?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    judge(
      'Does the code pass the organization value inside an authorizationParams object ' +
        '(on createAuth0Client or loginWithRedirect) rather than as a top-level "organization" option ' +
        'or a positional argument?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the vanilla JavaScript SPA using ' +
        '@auth0/auth0-spa-js — logging users into the specified organization, accepting organization ' +
        'invitation links via the invitation and organization query parameters, and identifying the ' +
        'logged-in organization from the org_id claim? Rejecting or blocking a valid invitation because ' +
        'its organization differs from the configured default org is a correctness defect, not a cosmetic ' +
        'one — treat it as a failure of invitation acceptance.',
    ),
  ];
}
