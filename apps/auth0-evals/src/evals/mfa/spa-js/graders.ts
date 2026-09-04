import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required step-up symbols present ───────────────────────────
    matches(
      String.raw`interactiveErrorHandler|acr_values`,
      'Step-up configured via interactiveErrorHandler (SDK default) or acr_values (manual approach)',
      GraderLevel.L1,
    ),
    contains('getTokenSilently', 'Access token requested via getTokenSilently to trigger step-up', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    // In-source rather than whole-workspace: agents write design notes, and a note
    // saying "we deliberately avoid @auth0/auth0-react here" is not a hallucination.
    notContainsInSource('speakeasy', 'No server-side TOTP library (speakeasy) used in client', GraderLevel.L2),
    notContainsInSource('otplib', 'No server-side TOTP library (otplib) used in client', GraderLevel.L2),
    notContainsInSource('@auth0/guardian', 'No fake Guardian client SDK referenced', GraderLevel.L2),
    notContainsInSource(
      'mfa/challenge',
      'Does not call raw MFA challenge endpoint directly (wrong approach for SPAs)',
      GraderLevel.L2,
    ),
    notContainsInSource('@auth0/auth0-react', 'No React SDK in vanilla JS app', GraderLevel.L2),
    notContainsInSource('client_secret', 'No client_secret in SPA (public client)', GraderLevel.L2),

    // ── L3: Security ──────────────────────────────────────────────────────
    judge(
      'Does the code avoid manually storing Auth0 tokens (access tokens, ID tokens, refresh tokens) ' +
        'in localStorage or sessionStorage? Storing application state such as a pending transfer ' +
        'object in sessionStorage is acceptable — only token storage is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    judge(
      'Does the code call getTokenSilently (not loginWithPopup) before executing the transfer ' +
        'action, so that the SDK can automatically trigger an MFA step-up popup (via interactiveErrorHandler) ' +
        'when the API signals mfa_required?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code handle popup failure errors (PopupCancelledError, PopupTimeoutError) or otherwise ' +
        'prevent the transfer from proceeding when MFA step-up was not completed?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is interactiveErrorHandler set to "popup" in the createAuth0Client configuration? ' +
        '(If using the manual acr_values approach instead, are acr_values ' +
        'and max_age: 0 passed inside authorizationParams on loginWithPopup?)',
      GraderLevel.L5,
    ),
    judge(
      'If the code uses the proactive approach (acr_values), is the value the multi-factor ' +
        'policy URI http://schemas.openid.net/pape/policies/2007/06/multi-factor rather than an ' +
        'invented or misspelled value? (Not applicable when using interactiveErrorHandler.)',
      GraderLevel.L5,
    ),
    judge(
      'If the code passes acr_values or max_age, are they inside an authorizationParams object ' +
        'rather than as top-level properties? (Not applicable when using interactiveErrorHandler.)',
      GraderLevel.L5,
    ),
    judge(
      'Does the solution use the auth0-spa-js v2 API — authorizationParams for auth parameters, ' +
        'camelCase clientId, and argument-less getIdTokenClaims() — rather than the v1 patterns ' +
        'of top-level audience/scope/redirect_uri, snake_case client_id, or ' +
        'getIdTokenClaims({ audience, scope })?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up authentication in a vanilla JavaScript SPA ' +
        'using @auth0/auth0-spa-js — either by configuring interactiveErrorHandler: "popup" ' +
        'so that getTokenSilently automatically triggers an MFA popup ' +
        'when the API requires it, or by explicitly requesting step-up via acr_values — and gating ' +
        'the Transfer Funds action behind successful MFA completion?',
    ),
  ];
}
