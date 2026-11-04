import { contains, notContains, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Custom Token Exchange symbols present ──────────────────
    contains('useAuth0', 'Uses the useAuth0 hook to reach the exchange method', GraderLevel.L1),
    contains(
      'CustomTokenExchange',
      'Calls a loginWithCustomTokenExchange / customTokenExchange method',
      GraderLevel.L1,
    ),
    contains('subject_token_type', 'Passes the snake_case subject_token_type option', GraderLevel.L1),
    contains('urn:barkbook:external-idp-token', 'Wires the configured subject_token_type', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContains(
      'exchangeToken',
      'No deprecated exchangeToken alias (use loginWithCustomTokenExchange)',
      GraderLevel.L2,
    ),
    notContains(
      '@auth0/auth0-spa-js',
      'Does not call the spa-js client directly — the exchange goes through the useAuth0 hook so React state updates',
      GraderLevel.L2,
    ),
    notContains('subjectTokenType', 'No camelCase subjectTokenType — options are snake_case', GraderLevel.L2),
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
      'Does the code let the SDK perform the exchange and manage the session, rather than hand-building ' +
        'a fetch/XHR POST to /oauth/token or persisting the subject token or the returned Auth0 tokens by ' +
        'hand in localStorage, sessionStorage, or a cookie?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    judge(
      'Does the code obtain the custom-token-exchange method from the useAuth0() hook (not by ' +
        'instantiating the spa-js client), pass the partner token as subject_token with subject_token_type ' +
        'set to urn:barkbook:external-idp-token, and call loginWithCustomTokenExchange so the Auth0 session ' +
        'is established and the React auth state updates?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Does the solution use the current loginWithCustomTokenExchange or customTokenExchange method from ' +
        'useAuth0() rather than the deprecated exchangeToken alias, with snake_case options ' +
        '(subject_token, subject_token_type)?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add Custom Token Exchange to the React app using @auth0/auth0-react — ' +
        'calling loginWithCustomTokenExchange (or customTokenExchange) from the useAuth0() hook with the ' +
        'partner token as subject_token and subject_token_type urn:barkbook:external-idp-token so an Auth0 ' +
        'session is established and the React auth state reflects the signed-in user, without calling the ' +
        'spa-js client directly, hand-rolling the grant, or storing tokens manually?',
    ),
  ];
}
