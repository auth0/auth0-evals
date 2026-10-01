import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Custom Token Exchange symbols present ──────────────────
    contains('get_token_by_exchange_profile', 'Calls get_token_by_exchange_profile', GraderLevel.L1),
    contains('subject_token_type', 'Passes the snake_case subject_token_type argument', GraderLevel.L1),
    contains('urn:barkbook:external-idp-token', 'Wires the configured subject_token_type', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContains(
      'get_token_on_behalf_of',
      'Not the OBO wrapper — it hardcodes IETF access-token types and cannot carry the partner subject_token_type',
      GraderLevel.L2,
    ),
    notContains(
      'subjectTokenType',
      'No camelCase subjectTokenType — auth0-api-python arguments are snake_case',
      GraderLevel.L2,
    ),
    notContains(
      'from auth0 import',
      'No auth0 Management SDK (wrong package — should use auth0-api-python)',
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
      'No hardcoded client secret in source — the pre-wired confidential client reads it from env',
      GraderLevel.L3,
    ),
    judge(
      'Does the code let the api_client perform the exchange rather than hand-building an httpx/requests ' +
        'POST to /oauth/token, pass the raw partner token as subject_token (not prefixed with "Bearer "), ' +
        'and avoid putting reserved parameters into extra?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project byte-compiles (compileall succeeds)', GraderLevel.L4),
    matches(
      String.raw`await\s+api_client\.get_token_by_exchange_profile\(`,
      'Awaits get_token_by_exchange_profile on the pre-configured client',
      GraderLevel.L4,
    ),
    judge(
      'Does the /api/partner-exchange handler await api_client.get_token_by_exchange_profile with ' +
        'subject_token set to the partner token the request carries and subject_token_type set to ' +
        'urn:barkbook:external-idp-token, then return the access token from the result to the caller?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Does the code use get_token_by_exchange_profile — the profile exchange where the caller supplies ' +
        'subject_token_type — rather than get_token_on_behalf_of, whose subject and requested token types ' +
        'are hardcoded to the IETF access-token type and cannot accept the partner token type?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly perform server-side Custom Token Exchange with auth0-api-python — ' +
        'awaiting api_client.get_token_by_exchange_profile with the partner token as subject_token and ' +
        'subject_token_type urn:barkbook:external-idp-token to obtain an Auth0 access token for ' +
        'https://api.barkbook.com — without reaching for the on-behalf-of wrapper, hand-rolling the grant, ' +
        'prefixing the subject token with "Bearer ", or hardcoding the client secret in source?',
    ),
  ];
}
