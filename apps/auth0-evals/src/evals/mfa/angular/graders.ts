import { contains, notContains, ranCommandOneOf, wroteFile, judge, compiles, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('acr_values', 'Step-up request uses acr_values parameter', GraderLevel.L1),
    contains('amr', 'AMR claim checked to detect prior MFA completion', GraderLevel.L1),
    contains('idTokenClaims$', 'ID token claims inspected via idTokenClaims$ observable', GraderLevel.L1),
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
      'Does the code subscribe to idTokenClaims$ (or otherwise read the amr claim from the ' +
        'ID token) before executing the transfer action, and only proceed when "mfa" is present ' +
        'in the amr array?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the code pass acr_values inside an authorizationParams object rather than ' +
        'as a top-level property on loginWithRedirect?',
      GraderLevel.L5,
    ),
    judge(
      'Does the code include max_age: 0 inside authorizationParams when requesting MFA ' +
        'step-up, to force re-authentication rather than reusing a cached session?',
      GraderLevel.L5,
    ),

    // ── L4: Leg 2 — tenant MFA factor configured ─────────────────────────
    wroteFile('.tf', 'Wrote Terraform resource enabling MFA Guardian factor', GraderLevel.L4, ['auth0_guardian']),
    ranCommandOneOf(
      ['guardian/factors/otp', 'guardian/factors/push', 'guardian/factors/sms'],
      'Enabled MFA factor via Auth0 CLI',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up authentication in an Angular app — ' +
        'checking the amr claim via idTokenClaims$, requesting step-up via acr_values when ' +
        'MFA is not present, gating the Transfer Funds action behind MFA verification, AND ' +
        'configuring the tenant MFA factor via Terraform or the Auth0 CLI?',
    ),
  ];
}
