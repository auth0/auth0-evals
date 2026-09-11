import { contains, notContains, notContainsInSource, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA-API symbols present ───────────────────────────────
    matches(
      String.raw`isMultifactorRequired|mfaRequiredErrorPayload`,
      'Detects the MFA-required signal on the AuthenticationException',
      GraderLevel.L1,
    ),
    contains('mfaToken', 'Reads the mfa_token off the error', GraderLevel.L1),
    matches(
      String.raw`mfaClient|MfaApiClient`,
      'Drives the flow through the SDK MFA API client (authentication.mfaClient(mfaToken))',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('auth0-java', 'No auth0-java (server-side SDK, not for Android)', GraderLevel.L2),
    notContains(
      'mfa/challenge',
      'Does not hand-roll the raw /mfa/challenge endpoint — use the SDK MFA client',
      GraderLevel.L2,
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in Kotlin source files (ok in strings.xml)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in Kotlin source files (ok in strings.xml)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code let SecureCredentialsManager (or CredentialsManager) handle token storage rather than ' +
        'persisting Auth0 tokens (access tokens, ID tokens, refresh tokens) by hand in SharedPreferences? ' +
        'Storing application state is acceptable — only manual token storage is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    judge(
      'Does the code catch the MFA-required error from the Authentication API login (isMultifactorRequired / ' +
        'mfaRequiredErrorPayload), read the mfaToken, and drive the MFA API flow through ' +
        'authentication.mfaClient(mfaToken) — challenging an enrolled factor and verifying the code (enrolling ' +
        'one first when the user has none) — before the login is treated as complete?',
      GraderLevel.L4,
    ),
    judge(
      'After a successful verify, does the code store the returned Credentials via the ' +
        'SecureCredentialsManager/CredentialsManager, rather than calling the raw /mfa endpoints directly or ' +
        'managing the returned tokens by hand?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the solution use the SDK MFA client API — authentication.mfaClient(mfaToken) with ' +
        'getAuthenticators / challenge / verify — rather than hand-building /oauth/token MFA-grant HTTP ' +
        'requests or the removed WebAuthProvider.init entry point?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly complete MFA at login in an Android app using Auth0.Android’s MFA API — ' +
        'detecting the MFA-required error, reading the mfaToken, challenging (or enrolling) a factor and ' +
        'verifying the code through authentication.mfaClient(...), and storing the resulting credentials so ' +
        'the user finishes signing in?',
    ),
  ];
}
