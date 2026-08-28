import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('getIdTokenClaims', 'ID token claims inspected via getIdTokenClaims', GraderLevel.L1),
    // Anchored to a property access or destructure — bare 'amr' also matches prose
    // in a README or a comment, which says nothing about the claim being read.
    matches(
      String.raw`\.\s*amr\b|\bamr\s*[,}=)]|\[\s*['"]amr['"]\s*\]`,
      'AMR claim read from the ID token claims',
      GraderLevel.L1,
    ),
    matches(
      String.raw`acr_values|interactiveErrorHandler`,
      'Requests step-up via acr_values or the interactive popup error handler',
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
      'Does not call raw MFA challenge endpoint (wrong approach for SPAs)',
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
    // The cache key is clientId+audience+scope only, so acr_values and max_age do not
    // bust it. A judge rather than a cacheMode regex because the redirect and popup
    // paths never call getTokenSilently, and both are valid solutions here.
    judge(
      'When requesting the stepped-up token, does the solution avoid getting back the stale ' +
        "pre-MFA cached token — via cacheMode: 'off', a distinct step-up scope or audience, or a " +
        'redirect/popup login? The SDK cache key is clientId+audience+scope only, so acr_values ' +
        'or max_age on their own do not bust the cache.',
      GraderLevel.L4,
    ),
    judge(
      'Does the code check the amr claim before executing the transfer action, and only ' +
        'proceed when "mfa" is present in the amr array?',
      GraderLevel.L4,
    ),
    judge(
      'After triggering step-up, does the code confirm MFA actually happened before running the ' +
        'transfer — re-reading the ID token claims and checking amr again, and aborting if the ' +
        'popup was cancelled or the redirect never completed? Proceeding unconditionally once ' +
        'step-up has been triggered does not satisfy this.',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'If the code passes acr_values, is its value the multi-factor policy URI ' +
        'http://schemas.openid.net/pape/policies/2007/06/multi-factor rather than an invented or ' +
        'misspelled value? A solution that triggers step-up via interactiveErrorHandler and passes ' +
        'no acr_values at all satisfies this — it is the approach the SDK documents.',
      GraderLevel.L5,
    ),
    judge(
      'If the code passes acr_values or max_age, are they inside an authorizationParams object ' +
        'rather than as top-level properties on getTokenSilently or loginWithRedirect? ' +
        'A solution that instead triggers step-up via interactiveErrorHandler and passes no ' +
        'acr_values at all satisfies this — it is the approach the SDK documents.',
      GraderLevel.L5,
    ),
    judge(
      'Does the solution force a fresh MFA challenge rather than reusing a cached session — ' +
        "via max_age: 0 inside authorizationParams, or cacheMode: 'off' on the silent token " +
        'request, or a redirect-based login? Any of these is acceptable.',
      GraderLevel.L5,
    ),
    judge(
      'Does the solution use the auth0-spa-js v2 API — authorizationParams for auth parameters, ' +
        'camelCase clientId, and an argument-less getIdTokenClaims() — rather than the v1 patterns ' +
        'of top-level audience/scope/redirect_uri, snake_case client_id, or ' +
        'getIdTokenClaims({ audience, scope })?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up authentication in a vanilla JavaScript SPA ' +
        'using @auth0/auth0-spa-js — checking the amr claim via auth0.getIdTokenClaims() on the ' +
        'Auth0Client instance, requesting step-up when MFA is not present (either via acr_values in ' +
        "authorizationParams or via interactiveErrorHandler: 'popup'), and gating the Transfer Funds " +
        'action behind MFA verification?',
    ),
  ];
}
