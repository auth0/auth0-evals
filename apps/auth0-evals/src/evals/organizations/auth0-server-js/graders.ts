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
    contains('startInteractiveLogin', 'Uses startInteractiveLogin to initiate org-scoped login', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK ─────────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2),
    notContains('@auth0/auth0-react', 'No React SDK in a Node.js web app', GraderLevel.L2),
    notContains(
      'useOrganization(',
      'No non-existent useOrganization hook (auth0-server-js is not hook-based)',
      GraderLevel.L2,
    ),
    notContains(
      'express-openid-connect',
      'No express-openid-connect (wrong SDK - app uses @auth0/auth0-server-js)',
      GraderLevel.L2,
    ),
    notContains('@auth0/auth0-auth-js', 'No low-level auth0-auth-js (wrong SDK for this web app)', GraderLevel.L2),

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
      String.raw`startInteractiveLogin[\s\S]{0,200}organization`,
      'Passes organization to startInteractiveLogin for org-scoped login',
      GraderLevel.L4,
    ),
    judge(
      'Does the code read the "invitation" and "organization" parameters from the request URL query ' +
        'string and forward them to startInteractiveLogin (as the "invitation" and "organization" options) ' +
        'when both are present? PASS when the code forwards both params to startInteractiveLogin and does ' +
        "not reject an invitation solely because its organization differs from the app's default org. " +
        'Grounding facts you MUST apply: Auth0 invitation links always carry both an `invitation` and an ' +
        '`organization` parameter, and the SDK requires `organization` whenever `invitation` is set ' +
        '(startInteractiveLogin/completeInteractiveLogin throws otherwise). Therefore returning an error ' +
        '(e.g. a 400) when an `invitation` arrives WITHOUT an `organization` param is CORRECT handling of a ' +
        'malformed link - it is the SDK-required precondition, NOT a defect, and MUST NOT cause a fail. ' +
        'Fail ONLY if the code ignores/drops the params, or rejects an invitation whose organization merely ' +
        "differs from the app's configured default org.",
      GraderLevel.L4,
    ),
    judge(
      'Does the code handle OrganizationValidationError (imported from @auth0/auth0-server-js) in the ' +
        'callback route - i.e. catch errors thrown by completeInteractiveLogin and check whether the error ' +
        'is an instanceof OrganizationValidationError, then respond appropriately?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code surface the organization the user logged into by reading the org_id claim from the ' +
        'session user (e.g. user.org_id obtained via serverClient.getUser), rather than hardcoding or guessing it?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    judge(
      'Does the code use current @auth0/auth0-server-js APIs - passing organization as a first-class ' +
        'option to startInteractiveLogin (not inside authorizationParams alone) or as the client-wide ' +
        '"organization" config key on ServerClient? Also confirm it does not use any removed or deprecated ' +
        'patterns such as initAuth0, handleAuth, or withPageAuthRequired from next-auth packages.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level - always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the Express web app using ' +
        '@auth0/auth0-server-js - logging users into the specified organization (org_barkbook_acme) via ' +
        'the organization option on startInteractiveLogin, accepting organization invitation links by ' +
        'forwarding invitation and organization query params, handling OrganizationValidationError on ' +
        'completeInteractiveLogin, and identifying the logged-in organization from the org_id claim on ' +
        'the session user? Auth0 invitation links always carry both an `invitation` and an ' +
        '`organization` parameter, and the SDK requires `organization` whenever `invitation` is set, so ' +
        'requiring or validating the organization param when an invitation is present is correct and must ' +
        'not be penalised. The only invitation-related correctness defect is rejecting a valid invitation ' +
        'because its organization differs from the configured default - treat that as a failure.',
    ),
  ];
}
