import { contains, notContains, notContainsInSource, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA-API symbols present ───────────────────────────────
    contains('mfaToken', 'Reads the mfa_token off the error (error.json.mfa_token)', GraderLevel.L1),
    matches(
      String.raw`mfa\.getAuthenticators|getAuthenticators`,
      'Lists enrolled authenticators through the SDK MFA client',
      GraderLevel.L1,
    ),
    matches(
      String.raw`mfa\.challenge`,
      'Drives a challenge through the SDK MFA client (mfa.challenge)',
      GraderLevel.L1,
    ),
    matches(
      String.raw`mfa\.verify`,
      'Verifies the OTP/OOB code through the SDK MFA client (mfa.verify)',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains(
      '@auth0/auth0-react',
      'No @auth0/auth0-react import — that is the web React SDK, not React Native',
      GraderLevel.L2,
    ),
    notContains('auth.loginWithOTP', 'Does not use auth.loginWithOTP — deprecated and removed in v6', GraderLevel.L2),
    notContains('auth.loginWithOOB', 'Does not use auth.loginWithOOB — deprecated and removed in v6', GraderLevel.L2),
    notContains(
      'auth.multifactorChallenge',
      'Does not use auth.multifactorChallenge — deprecated and removed in v6',
      GraderLevel.L2,
    ),
    notContains(
      'mfa/challenge',
      'Does not hand-roll the raw /mfa/challenge endpoint — use the SDK MFA client',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in config files)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in source files (ok in config files)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code store credentials via credentialsManager.saveCredentials() rather than persisting ' +
        'Auth0 tokens (access tokens, ID tokens, refresh tokens) by hand in AsyncStorage or plain component state?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    judge(
      'Does the code catch the MFA-required error from passwordRealm (reading error.json.mfa_token as the ' +
        'mfaToken), drive the MFA flow through mfa.getAuthenticators and mfa.challenge or mfa.enroll followed ' +
        'by mfa.verify, before the login is treated as complete?',
      GraderLevel.L4,
    ),
    judge(
      'After a successful mfa.verify, does the code store the returned credentials via ' +
        'credentialsManager.saveCredentials(), rather than calling raw /mfa endpoints directly or managing ' +
        'the returned tokens by hand?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the solution use the current mfa sub-client API (mfa.getAuthenticators, mfa.challenge, mfa.verify ' +
        'obtained via useAuth0()) rather than the deprecated auth.loginWithOTP, auth.loginWithOOB, or ' +
        'auth.multifactorChallenge methods?',
      GraderLevel.L5,
    ),

    // Holistic judge (no level -- always runs)
    judge(
      "Does the solution correctly complete MFA at login in a React Native app using react-native-auth0's MFA API -- " +
        'detecting the MFA-required error from passwordRealm, reading the mfaToken from error.json.mfa_token, ' +
        'challenging (or enrolling) a factor through mfa.challenge/mfa.enroll and verifying the code through ' +
        'mfa.verify(), and storing the resulting credentials via credentialsManager.saveCredentials() so the ' +
        'user finishes signing in?',
      undefined,
      {
        context:
          'the scaffold uses react-native-auth0 v5, which introduced auth0.mfa() returning an IMfaClient ' +
          '(with getAuthenticators, enroll, challenge, verify); the pre-v5 methods auth.loginWithOTP, ' +
          'auth.loginWithOOB, auth.loginWithRecoveryCode, and auth.multifactorChallenge were deprecated in v5 ' +
          'and will be removed in v6. error.json.mfa_token IS the real v5 API for reading the mfaToken from a ' +
          'passwordRealm error. Grade the structural flow only -- do not mark correct v5 API usage as ' +
          'fabricated based on pre-v5 knowledge.',
      },
    ),
  ];
}
