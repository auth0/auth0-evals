import { contains, notContains, notContainsInSource, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA-API symbols present ───────────────────────────────
    contains(
      'mfaRequiredErrorPayload',
      'Detects the MFA-required signal via error.mfaRequiredErrorPayload',
      GraderLevel.L1,
    ),
    contains('mfaToken', 'Reads the mfa_token off the error', GraderLevel.L1),
    matches(String.raw`\.mfa\(|MFAClient`, 'Drives the flow through the SDK MFA client (Auth0.mfa())', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('Auth0SDK', 'No hallucinated Auth0SDK package name (correct package is Auth0)', GraderLevel.L2),
    notContains(
      'mfa/challenge',
      'Does not hand-roll the raw /mfa/challenge endpoint — use the SDK MFA client',
      GraderLevel.L2,
    ),

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
        'application state is acceptable — only manual token storage is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    judge(
      'Does the code catch the MFA-required error from the Authentication API login (a non-nil ' +
        'error.mfaRequiredErrorPayload), read the mfaToken, and drive the MFA API flow through Auth0.mfa() — ' +
        'challenging an enrolled factor and verifying the code (enrolling one first when the user has none) — ' +
        'before the login is treated as complete?',
      GraderLevel.L4,
    ),
    judge(
      'After a successful verify, does the code store the returned Credentials via the CredentialsManager, ' +
        'rather than calling the raw /mfa endpoints directly or managing the returned tokens by hand?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the solution use the current MFA client API — Auth0.mfa() with getAuthenticators / challenge / ' +
        'verify(otp:mfaToken:) (or the oobCode/recoveryCode verify variants) — rather than hand-building ' +
        '/oauth/token MFA-grant HTTP requests?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly complete MFA at login in a Swift iOS app using Auth0.swift’s MFA API — ' +
        'detecting the MFA-required error, reading the mfaToken, challenging (or enrolling) a factor and ' +
        'verifying the code through Auth0.mfa(), and storing the resulting credentials so the user finishes ' +
        'signing in?',
    ),
  ];
}
