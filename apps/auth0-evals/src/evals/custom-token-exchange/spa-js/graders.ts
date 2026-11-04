import { contains, notContains, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Custom Token Exchange symbols present ──────────────────
    contains(
      'CustomTokenExchange',
      'Calls a loginWithCustomTokenExchange / customTokenExchange method',
      GraderLevel.L1,
    ),
    contains('subject_token_type', 'Passes the snake_case subject_token_type option', GraderLevel.L1),
    contains('urn:barkbook:external-idp-token', 'Wires the configured subject_token_type', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContains('@auth0/auth0-react', 'No React SDK in a vanilla JS app', GraderLevel.L2),
    notContains(
      'exchangeToken',
      'No deprecated exchangeToken alias (use loginWithCustomTokenExchange)',
      GraderLevel.L2,
    ),
    notContains(
      'subjectTokenType',
      'No camelCase subjectTokenType — auth0-spa-js options are snake_case',
      GraderLevel.L2,
    ),
    notContains(
      'urn:ietf:params:oauth:grant-type:token-exchange',
      'No hand-rolled token-exchange grant — the SDK issues the /oauth/token call',
      GraderLevel.L2,
    ),
    notContains('client_secret', 'No client_secret in a SPA (public client)', GraderLevel.L2),

    // ── L3: Security ────────────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens stored in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens stored in sessionStorage', GraderLevel.L3),
    judge(
      'Does the code let the auth0-spa-js client perform the exchange and store the resulting tokens, ' +
        'rather than hand-building a fetch/XHR POST to /oauth/token or persisting the subject token or the ' +
        'returned Auth0 tokens by hand in localStorage, sessionStorage, or a cookie?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    matches(
      String.raw`CustomTokenExchange\(\s*\{[\s\S]{0,200}subject_token`,
      'Calls the exchange method with a subject_token options object',
      GraderLevel.L4,
    ),
    judge(
      'Does the code pass the partner token as subject_token together with subject_token_type ' +
        'set to urn:barkbook:external-idp-token into the auth0-spa-js custom-token-exchange method, ' +
        'and does it establish an Auth0 session (using loginWithCustomTokenExchange, the variant that ' +
        'stores the session) rather than discarding the result?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Does the solution use the current loginWithCustomTokenExchange or customTokenExchange method ' +
        'rather than the deprecated exchangeToken alias, and does it pass options in snake_case ' +
        '(subject_token, subject_token_type) as the current auth0-spa-js API expects?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add Custom Token Exchange to the vanilla JavaScript SPA using ' +
        '@auth0/auth0-spa-js — passing the partner-issued token as subject_token with subject_token_type ' +
        'urn:barkbook:external-idp-token to loginWithCustomTokenExchange so an Auth0 session is established, ' +
        'without hand-rolling the token-exchange grant and without storing tokens manually?',
    ),
  ];
}
