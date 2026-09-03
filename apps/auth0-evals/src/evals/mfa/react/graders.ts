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
      'Does the code gate the Transfer Funds action behind MFA step-up so the transfer cannot run ' +
        'without MFA — either by calling getAccessTokenSilently for the sensitive scope so the SDK ' +
        'triggers an interactiveErrorHandler popup when the API signals mfa_required, or by checking ' +
        'the amr claim and requesting step-up via acr_values when "mfa" is not present?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'If the code takes the manual acr_values approach, are acr_values and max_age: 0 passed inside ' +
        'an authorizationParams object (rather than as top-level properties) on getAccessTokenSilently, ' +
        'getAccessTokenWithPopup or loginWithRedirect? (Not applicable when relying on interactiveErrorHandler.)',
      GraderLevel.L5,
    ),
    judge(
      'If the code takes the manual acr_values approach, is the value the multi-factor policy URI ' +
        'http://schemas.openid.net/pape/policies/2007/06/multi-factor rather than an invented or ' +
        'misspelled value? (Not applicable when relying on interactiveErrorHandler.)',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up authentication in a React app using ' +
        '@auth0/auth0-react — either by configuring interactiveErrorHandler: "popup" so that ' +
        'getAccessTokenSilently automatically triggers an MFA popup when the API requires it, or by ' +
        'explicitly requesting step-up via acr_values — and gating the Transfer Funds action behind ' +
        'successful MFA completion?',
    ),
  ];
}
