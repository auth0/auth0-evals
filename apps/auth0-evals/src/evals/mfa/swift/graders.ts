import { contains, notContains, notContainsInSource, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('acr_values', 'Step-up request uses acr_values parameter', GraderLevel.L1),
    contains('amr', 'AMR claim checked to detect prior MFA completion', GraderLevel.L1),
    contains(
      'schemas.openid.net/pape/policies/2007/06/multi-factor',
      'Uses correct multi-factor acr_values policy URI',
      GraderLevel.L1,
    ),
    // Auth0.swift exposes claims two legitimate ways: JWTDecode (a public
    // dependency of the SDK) or CredentialsManager.userProfile()?.customClaims.
    matches(
      String.raw`decode\(jwt:|customClaims`,
      'Reads ID token claims via JWTDecode or UserProfile.customClaims',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('Auth0SDK', 'No hallucinated Auth0SDK package name (correct package is Auth0)', GraderLevel.L2),
    // Every embedded-MFA path carries the mfa_token, whether or not the
    // MFAClient type is ever named (Auth0.mfa().verify(otp:mfaToken:)).
    notContains(
      'mfaToken',
      'Does not use the embedded MFA grant (Auth0.mfa()/MFAClient) — wrong approach for a Universal Login app',
      GraderLevel.L2,
      { caseSensitive: false },
    ),
    notContains('mfa/challenge', 'Does not call the raw MFA challenge endpoint', GraderLevel.L2),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in Swift source files (ok in Auth0.plist)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in Swift source files (ok in Auth0.plist)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code let CredentialsManager handle token storage rather than persisting Auth0 tokens ' +
        '(access tokens, ID tokens, refresh tokens) by hand in UserDefaults or the Keychain? Storing ' +
        'application state such as a pending transfer is acceptable — only manual token storage is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    judge(
      'Does the code check the amr claim before executing the transfer action, and only proceed when ' +
        '"mfa" is present in the amr array? Reading amr via JWTDecode (decode(jwt:).claim(name: "amr")) ' +
        'or via CredentialsManager.userProfile()?.customClaims are both acceptable.',
      GraderLevel.L4,
    ),
    judge(
      'When MFA is missing, is step-up performed by starting a new Universal Login web auth session — ' +
        'Auth0.webAuth() with the MFA acr_values — rather than by calling the Authentication API MFA ' +
        'endpoints (challenge/verify) directly?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    // `.parameters` / `.maxAge` are the current builders for extra authorization
    // parameters. The scaffold's login call uses neither, so this only passes if
    // the agent built the step-up request itself.
    matches(
      String.raw`\.parameters\(|\.maxAge\(`,
      'Step-up parameters passed through the current .parameters/.maxAge builders',
      GraderLevel.L5,
    ),
    judge(
      'Does the step-up request force fresh authentication with a max_age of 0, so a cached session is ' +
        'not reused? Either the dedicated .maxAge(0) builder or "max_age" inside .parameters([...]) counts.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up authentication in a Swift iOS app — reading the ' +
        'amr claim from the ID token (via JWTDecode or UserProfile.customClaims), requesting step-up ' +
        'through Auth0.webAuth() with acr_values and max_age 0 when MFA is not present, and gating the ' +
        'Transfer Funds action behind MFA verification?',
    ),
  ];
}
