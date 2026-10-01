import { contains, notContains, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Custom Token Exchange symbols present ──────────────────
    contains('customTokenExchange', 'Calls Auth0Client#customTokenExchange', GraderLevel.L1),
    contains('subjectToken', 'Passes the camelCase subjectToken option', GraderLevel.L1),
    contains('subjectTokenType', 'Passes the camelCase subjectTokenType option', GraderLevel.L1),
    contains('urn:barkbook:external-idp-token', 'Wires the configured subjectTokenType', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContains('@auth0/auth0-react', 'No React SDK in a server-side Next.js app', GraderLevel.L2),
    notContains(
      'subject_token_type',
      'No snake_case subject_token_type — @auth0/nextjs-auth0 options are camelCase',
      GraderLevel.L2,
    ),
    notContains(
      'loginWithCustomTokenExchange',
      'No spa-js session method — nextjs exposes customTokenExchange and does not mutate the session',
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
      'No hardcoded client secret in source (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource('barkbook_client_abc123xyz', 'No hardcoded client ID in source (ok in .env)', GraderLevel.L3),
    notContainsInSource('dev-barkbook.us.auth0.com', 'No hardcoded domain in source (ok in .env)', GraderLevel.L3),
    judge(
      'Does the exchange run entirely server-side and avoid exposing the partner subject token or the ' +
        'returned Auth0 tokens to the browser — not returning them from a Server Component as props to a ' +
        'Client Component, not sending them in the JSON response to the caller, and not hand-building a ' +
        'fetch POST to /oauth/token instead of using the SDK method?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    judge(
      'Does the Route Handler call auth0.customTokenExchange with the partner token as subjectToken and ' +
        'subjectTokenType set to urn:barkbook:external-idp-token, read the access token from the returned ' +
        'CustomTokenExchangeResponse, and import the Auth0Client from @auth0/nextjs-auth0/server (with any ' +
        'option or response types from @auth0/nextjs-auth0/types)?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    notContains('handleAuth', 'Does not use v3 handleAuth (v4 uses the Auth0Client)', GraderLevel.L5),
    notContains('/api/auth/', 'Does not use the v3 /api/auth/ route prefix', GraderLevel.L5),
    judge(
      'Does the solution use v4 @auth0/nextjs-auth0 patterns — the Auth0Client from ' +
        '@auth0/nextjs-auth0/server and its customTokenExchange method with camelCase options — rather than ' +
        'any v3 pattern such as handleAuth or getAccessToken, and rather than a hand-built token request?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add Custom Token Exchange to the Next.js App Router app using ' +
        '@auth0/nextjs-auth0 v4 — a server-side Route Handler that calls auth0.customTokenExchange with the ' +
        'partner token as subjectToken and subjectTokenType urn:barkbook:external-idp-token, keeps the ' +
        'subject token and returned tokens on the server, and does not hand-roll the token-exchange grant?',
    ),
  ];
}
