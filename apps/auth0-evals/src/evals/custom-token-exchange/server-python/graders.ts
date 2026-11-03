import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Custom Token Exchange symbols present ──────────────────
    contains('custom_token_exchange', 'Calls custom_token_exchange / login_with_custom_token_exchange', GraderLevel.L1),
    contains('subject_token_type', 'Passes the snake_case subject_token_type option', GraderLevel.L1),
    contains('urn:barkbook:external-idp-token', 'Wires the configured subject_token_type', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContains(
      'from auth0 import',
      'No auth0 Management SDK (wrong package — should use auth0-server-python)',
      GraderLevel.L2,
    ),
    notContains('@auth0/organizations', 'No hallucinated JS package in a Python app', GraderLevel.L2),
    notContains(
      'subjectTokenType',
      'No camelCase subjectTokenType — auth0-server-python options are snake_case',
      GraderLevel.L2,
    ),
    notContains(
      'urn:ietf:params:oauth:grant-type:token-exchange',
      'No hand-rolled token-exchange grant — the SDK issues the /oauth/token call',
      GraderLevel.L2,
    ),

    // ── L3: Security ────────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded Auth0 client secret in source (allowed only in .env)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code let the ServerClient perform the exchange rather than hand-building an httpx/requests ' +
        'POST to /oauth/token, pass the raw partner token as subject_token (not prefixed with "Bearer "), ' +
        'and avoid persisting the subject token or the returned Auth0 tokens by hand?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project byte-compiles (compileall succeeds)', GraderLevel.L4),
    contains(
      'CustomTokenExchangeOptions',
      'Builds a typed CustomTokenExchangeOptions / LoginWithCustomTokenExchangeOptions object for the call',
      GraderLevel.L4,
    ),
    matches(
      String.raw`login_with_custom_token_exchange|custom_token_exchange\(`,
      'Awaits the custom-token-exchange method on the ServerClient',
      GraderLevel.L4,
    ),
    judge(
      'Does the /partner-login handler await login_with_custom_token_exchange (the variant that writes the ' +
        'session) with a LoginWithCustomTokenExchangeOptions carrying subject_token set to the partner token and ' +
        'subject_token_type set to urn:barkbook:external-idp-token, so the user ends up with an Auth0 session?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Does the code pass a typed CustomTokenExchangeOptions / LoginWithCustomTokenExchangeOptions instance ' +
        'to the method rather than a raw dict, matching the current auth0-server-python API?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add Custom Token Exchange to the Python web app using auth0-server-python — ' +
        'awaiting login_with_custom_token_exchange with a LoginWithCustomTokenExchangeOptions carrying subject_token ' +
        'and subject_token_type urn:barkbook:external-idp-token so an Auth0 session is established, without ' +
        'hand-rolling the grant, prefixing the subject token with "Bearer ", or storing tokens manually?',
    ),
  ];
}
