import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  compiles,
  GraderLevel,
} from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('organization', 'Passes the organization parameter for org-scoped login', GraderLevel.L1),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1),
    contains('invitation', 'Handles the organization invitation parameter', GraderLevel.L1),
    contains('org_id', 'Reads the org_id claim to identify the logged-in organization', GraderLevel.L1),
    contains('buildAuthorizationUrl', 'Uses buildAuthorizationUrl to initiate org-scoped login', GraderLevel.L1),
    contains('getTokenByCode', 'Uses getTokenByCode to exchange the authorization code', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK ─────────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2),
    notContains('@auth0/auth0-react', 'No React SDK in a Node.js server app', GraderLevel.L2),
    notContains(
      'useOrganization(',
      'No non-existent useOrganization hook (auth0-auth-js is not hook-based)',
      GraderLevel.L2,
    ),
    notContains(
      'express-openid-connect',
      'No express-openid-connect (wrong SDK for this low-level auth client)',
      GraderLevel.L2,
    ),

    // ── L3: Security ───────────────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in .env)',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ─────────────────────────────────────────
    compiles('Project compiles (tsc succeeds)', GraderLevel.L4),
    matches(
      String.raw`authorizationParams[\s\S]{0,160}organization`,
      'Passes organization inside authorizationParams when building the authorization URL',
      GraderLevel.L4,
    ),
    judge(
      'Does the code read the "invitation" and "organization" parameters from the callback/login ' +
        'request URL and forward them to buildAuthorizationUrl (inside authorizationParams) when present? ' +
        "The invitation's own organization must be forwarded and must not be rejected solely because it " +
        "differs from the app's default org.",
      GraderLevel.L4,
    ),
    judge(
      'Does the code pass the organization to getTokenByCode (as the "organization" option) so the ' +
        'SDK validates the org_id claim of the returned ID token? And does it handle ' +
        'OrganizationValidationError (imported from @auth0/auth0-auth-js) when the claim is missing ' +
        'or mismatched?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    judge(
      'Does the code pass the organization value inside an authorizationParams object when calling ' +
        'buildAuthorizationUrl - i.e. as authorizationParams.organization - rather than as a top-level ' +
        'option or a legacy format? Also confirm it uses the current @auth0/auth0-auth-js APIs ' +
        '(AuthClient, buildAuthorizationUrl, getTokenByCode) and not any removed or deprecated patterns.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level - always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the Node.js auth service using ' +
        '@auth0/auth0-auth-js - building authorization URLs scoped to the specified organization ' +
        '(org_barkbook_acme) via authorizationParams.organization, accepting organization invitation ' +
        'links by forwarding invitation and organization query params to buildAuthorizationUrl, ' +
        'validating the org claim during getTokenByCode, and surfacing the org_id claim from the ' +
        'returned ID token? Rejecting a valid invitation because its organization differs from the ' +
        'configured default is a correctness defect - treat it as a failure.',
    ),
  ];
}
