import { notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required step-up symbols present ───────────────────────────
    // Reactive approach: MfaRequiredError caught and mfa_token passed to loginWithPopup.
    // Proactive approach: acr_values or interactiveErrorHandler trigger step-up upfront.
    matches(
      String.raw`MfaRequiredError|acr_values|interactiveErrorHandler`,
      'Step-up triggered via MfaRequiredError (reactive) or acr_values / interactiveErrorHandler (proactive)',
      GraderLevel.L1,
    ),
    // Reactive: mfa_token forwarded to loginWithPopup.
    // Proactive: AMR claim read from ID token to verify MFA completed.
    matches(
      String.raw`mfa_token|\.\s*amr\b|\bamr\s*[,}=)]|\[\s*['"]amr['"]\s*\]`,
      'mfa_token used with loginWithPopup (reactive) or AMR claim verified after step-up (proactive)',
      GraderLevel.L1,
    ),

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
      'Does the code gate the transfer action behind MFA completion — either by catching ' +
        'MfaRequiredError and calling loginWithPopup with the mfa_token before proceeding ' +
        '(reactive), or by checking the amr claim upfront and requesting step-up when "mfa" ' +
        'is absent (proactive)?',
      GraderLevel.L4,
    ),
    judge(
      'After triggering step-up, does the code confirm MFA actually completed before running ' +
        'the transfer — for the reactive approach, verifying loginWithPopup resolved without ' +
        'error; for the proactive approach, re-reading the token claims to check amr again? ' +
        'Proceeding unconditionally after triggering step-up does not satisfy this.',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'If the code uses the proactive approach (acr_values), is the value the multi-factor ' +
        'policy URI http://schemas.openid.net/pape/policies/2007/06/multi-factor rather than an ' +
        'invented or misspelled value? (Not applicable when using the reactive MfaRequiredError approach.)',
      GraderLevel.L5,
    ),
    judge(
      'If the code passes acr_values or max_age, are they inside an authorizationParams object ' +
        'rather than as top-level properties? ' +
        '(Not applicable when using the reactive MfaRequiredError approach.)',
      GraderLevel.L5,
    ),
    judge(
      'Does the solution force a fresh MFA challenge — via max_age: 0 inside authorizationParams ' +
        "or cacheMode: 'off' on the silent token request (proactive), or by passing the mfa_token " +
        'directly to loginWithPopup (reactive)?',
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
        'using @auth0/auth0-spa-js — either reactively (catching MfaRequiredError from getTokenSilently ' +
        'and calling loginWithPopup with the mfa_token) or proactively (requesting step-up via ' +
        'acr_values in authorizationParams and verifying the amr claim) — and gating the Transfer ' +
        'Funds action behind confirmed MFA completion?',
    ),
  ];
}
