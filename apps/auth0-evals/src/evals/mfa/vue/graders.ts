import { contains, notContains, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required step-up symbols present ───────────────────────────
    matches(
      String.raw`interactiveErrorHandler|acr_values`,
      'Step-up configured via interactiveErrorHandler (SDK default) or acr_values (manual approach)',
      GraderLevel.L1,
    ),
    contains(
      'getAccessTokenSilently',
      'Access token requested via getAccessTokenSilently to trigger step-up',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('speakeasy', 'No server-side TOTP library (speakeasy) used in client', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib) used in client', GraderLevel.L2),
    notContains('@auth0/guardian', 'No fake Guardian client SDK referenced', GraderLevel.L2),
    notContains('mfa/challenge', 'Does not call raw MFA challenge endpoint (wrong approach for SPAs)', GraderLevel.L2),
    notContains('@auth0/auth0-react', 'Does not use React SDK in Vue app', GraderLevel.L2),

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
      'Does the code call getAccessTokenSilently (via the useAuth0 composable) before executing the ' +
        'transfer action, so that the SDK can automatically trigger an MFA step-up popup (via ' +
        'interactiveErrorHandler) when the API signals mfa_required?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code handle popup failure errors (PopupCancelledError, PopupTimeoutError) or otherwise ' +
        'prevent the transfer from proceeding when MFA step-up was not completed?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is interactiveErrorHandler set to "popup" in the createAuth0 plugin configuration, alongside ' +
        'useRefreshTokens: true? (If using the manual acr_values approach instead, are acr_values ' +
        'and max_age: 0 passed inside authorizationParams on loginWithRedirect?)',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up authentication in a Vue 3 app using ' +
        '@auth0/auth0-vue — either by configuring interactiveErrorHandler: "popup" with ' +
        'useRefreshTokens: true so that getAccessTokenSilently automatically triggers an MFA popup ' +
        'when the API requires it, or by explicitly requesting step-up via acr_values — and gating ' +
        'the Transfer Funds action behind successful MFA completion?',
    ),
  ];
}
