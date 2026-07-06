import { contains, notContains, judge, compiles, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('acr_values', 'Step-up request uses acr_values parameter', GraderLevel.L1),
    contains('amr', 'AMR claim checked to detect prior MFA completion', GraderLevel.L1),
    contains('idTokenClaims', 'ID token claims read from idTokenClaims reactive ref', GraderLevel.L1),
    contains(
      'schemas.openid.net/pape/policies/2007/06/multi-factor',
      'Uses correct multi-factor acr_values policy URI',
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
    contains('useAuth0', 'Uses useAuth0 composable from @auth0/auth0-vue', GraderLevel.L4),
    judge(
      'Does the code check the amr claim before executing the transfer action, and only ' +
        'proceed when "mfa" is present in the amr array?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the code pass acr_values inside an authorizationParams object rather than ' +
        'as a top-level property on getAccessTokenSilently or loginWithRedirect?',
      GraderLevel.L5,
    ),
    judge(
      'Does the code include max_age: 0 inside authorizationParams when requesting MFA ' +
        'step-up, to force re-authentication rather than reusing a cached session?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    // Tenant-side MFA enforcement (Guardian factors + policies) is measured
    // separately by the standalone mfa_tenant_cli / mfa_tenant_terraform evals;
    // this eval scores only the Vue client step-up flow.
    judge(
      'Does the solution correctly implement MFA step-up authentication in a Vue 3 app — ' +
        'checking the amr claim via the idTokenClaims reactive ref, requesting step-up via acr_values when ' +
        'MFA is not present, and gating the Transfer Funds action behind MFA verification?',
    ),
  ];
}
