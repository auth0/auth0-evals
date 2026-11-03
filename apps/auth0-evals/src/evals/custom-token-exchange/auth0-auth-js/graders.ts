import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Custom Token Exchange symbols present ──────────────────
    contains('exchangeToken', 'Calls AuthClient#exchangeToken', GraderLevel.L1),
    contains('subjectTokenType', 'Passes the camelCase subjectTokenType option', GraderLevel.L1),
    contains('urn:barkbook:external-idp-token', 'Wires the configured subjectTokenType', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContains('@auth0/auth0-react', 'No React SDK in a Node.js server app', GraderLevel.L2),
    notContains(
      'getTokenForConnection',
      'No getTokenForConnection — that is Token Vault, not Custom Token Exchange',
      GraderLevel.L2,
    ),
    notContains(
      'subject_token_type',
      'No snake_case subject_token_type — @auth0/auth0-auth-js options are camelCase',
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
      'Does the code let AuthClient#exchangeToken perform the exchange rather than hand-building a fetch ' +
        'POST to /oauth/token, and does it avoid persisting the partner subject token or returning it to an ' +
        'untrusted caller?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project compiles (tsc succeeds)', GraderLevel.L4),
    matches(
      String.raw`exchangeToken\(\s*\{[\s\S]{0,200}subjectToken`,
      'Calls exchangeToken with a subjectToken options object',
      GraderLevel.L4,
    ),
    judge(
      'Does the code call AuthClient#exchangeToken with subjectToken set to the partner token and ' +
        'subjectTokenType set to urn:barkbook:external-idp-token, WITHOUT a connection option — passing a ' +
        'connection would switch exchangeToken to a Token Vault lookup, which is not Custom Token Exchange — ' +
        'and read the access token from the returned TokenResponse?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Does the solution use the current @auth0/auth0-auth-js Custom Token Exchange API — AuthClient#exchangeToken ' +
        'with camelCase ExchangeProfileOptions and no connection option — rather than the deprecated ' +
        'getTokenForConnection method or a hand-built token request?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add Custom Token Exchange to the Node.js auth service using ' +
        '@auth0/auth0-auth-js — calling AuthClient#exchangeToken with the partner token as subjectToken and ' +
        'subjectTokenType urn:barkbook:external-idp-token and no connection option, reading the access token ' +
        'from the TokenResponse, without hand-rolling the grant or using the Token Vault getTokenForConnection path?',
    ),
  ];
}
