import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Custom Token Exchange symbols present ──────────────────
    contains('CustomTokenExchange', 'Calls loginWithCustomTokenExchange / customTokenExchange', GraderLevel.L1),
    contains('subjectTokenType', 'Passes the camelCase subjectTokenType option', GraderLevel.L1),
    contains('urn:barkbook:external-idp-token', 'Wires the configured subjectTokenType', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContains('@auth0/auth0-react', 'No React SDK in a Node.js web app', GraderLevel.L2),
    notContains(
      '@auth0/auth0-auth-js',
      'No low-level auth0-auth-js — the app uses @auth0/auth0-server-js',
      GraderLevel.L2,
    ),
    notContains('getTokenForConnection', 'No Token Vault getTokenForConnection — that is not CTE', GraderLevel.L2),
    notContains(
      'subject_token_type',
      'No snake_case subject_token_type — @auth0/auth0-server-js options are camelCase',
      GraderLevel.L2,
    ),
    notContains(
      'urn:ietf:params:oauth:grant-type:token-exchange',
      'No hand-rolled token-exchange grant — the SDK issues the /oauth/token call',
      GraderLevel.L2,
    ),

    // ── L3: Security ────────────────────────────────────────────────────────
    notContainsInSource('dev-barkbook.us.auth0.com', 'No hardcoded domain in source (ok in .env)', GraderLevel.L3),
    notContainsInSource('barkbook_client_abc123xyz', 'No hardcoded client ID in source (ok in .env)', GraderLevel.L3),
    judge(
      'Does the code let the ServerClient perform the exchange and manage the session (via its StateStore) ' +
        'rather than hand-building a fetch POST to /oauth/token or persisting the partner subject token or ' +
        'the returned Auth0 tokens by hand?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project compiles (tsc succeeds)', GraderLevel.L4),
    matches(
      String.raw`CustomTokenExchange\([\s\S]{0,200}subjectToken`,
      'Calls the exchange method with a subjectToken options object',
      GraderLevel.L4,
    ),
    judge(
      'Does the /partner-login route call the ServerClient loginWithCustomTokenExchange method (the ' +
        'variant that writes the session) with subjectToken set to the partner token and subjectTokenType ' +
        'set to urn:barkbook:external-idp-token, so the user ends up with an Auth0 session?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Does the solution use the current @auth0/auth0-server-js Custom Token Exchange API — the ServerClient ' +
        'loginWithCustomTokenExchange or customTokenExchange method with camelCase options — rather than a ' +
        'Token Vault method or a hand-built token request?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add Custom Token Exchange to the Express app using @auth0/auth0-server-js — ' +
        'calling loginWithCustomTokenExchange with the partner token as subjectToken and subjectTokenType ' +
        'urn:barkbook:external-idp-token so an Auth0 session is established, without hand-rolling the grant, ' +
        'using a Token Vault method, or storing tokens manually?',
    ),
  ];
}
