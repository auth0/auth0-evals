import { contains, notContains, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA-API symbols present ───────────────────────────────
    contains('mfa_token', 'Reads the mfa_token off the error (error.json.mfa_token)', GraderLevel.L1),
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
    notContains(
      'authorizeWithOTP',
      'Does not use the legacy authorizeWithOTP direct step-up — use the mfa sub-client (mfa.verify)',
      GraderLevel.L2,
    ),
    notContains(
      'authorizeWithOOB',
      'Does not use the legacy authorizeWithOOB direct step-up — use the mfa sub-client',
      GraderLevel.L2,
    ),
    notContains(
      'sendMultifactorChallenge',
      'Does not use the legacy sendMultifactorChallenge — use mfa.challenge',
      GraderLevel.L2,
    ),
    notContains(
      'mfa/challenge',
      'Does not hand-roll the raw /mfa/challenge endpoint — use the SDK MFA client',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    // Note: the domain and client ID are not secrets for a React Native public client (they ship in the app
    // bundle), and the task permits edits only to App.tsx — a source file — so there is nowhere else to put
    // them. A notContainsInSource check on those values would reject every correct solution, so it is omitted.
    judge(
      "Does the code let the SDK persist credentials — via the hook's automatic persistence on " +
        "loginWithPasswordRealm/mfa.verify, a top-level saveCredentials(), or the class client's " +
        'credentialsManager.saveCredentials() — rather than writing Auth0 tokens (access, ID, or refresh ' +
        'tokens) by hand into AsyncStorage or plain component state?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    judge(
      'Does the code catch the MFA-required error from loginWithPasswordRealm (reading error.json.mfa_token as ' +
        'the mfa_token), drive the MFA flow through mfa.getAuthenticators and mfa.challenge or mfa.enroll ' +
        'followed by mfa.verify, before the login is treated as complete?',
      GraderLevel.L4,
    ),
    judge(
      'After a successful mfa.verify, are the returned credentials persisted through the SDK — either ' +
        "automatically by the hook's verify (which saves before resolving) or by an explicit " +
        'saveCredentials()/credentialsManager.saveCredentials() call — rather than the code calling raw ' +
        '/mfa endpoints directly or managing the returned tokens by hand?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the solution use the current mfa sub-client API (mfa.getAuthenticators, mfa.challenge, mfa.verify ' +
        'obtained via useAuth0()) rather than the legacy direct step-up methods authorizeWithOTP, authorizeWithOOB, ' +
        'sendMultifactorChallenge, or authorizeWithRecoveryCode?',
      GraderLevel.L5,
    ),

    // Holistic judge (no level -- always runs)
    judge(
      "Does the solution correctly complete MFA at login in a React Native app using react-native-auth0's MFA API -- " +
        'detecting the MFA-required error from loginWithPasswordRealm, reading the mfa_token from ' +
        'error.json.mfa_token, challenging (or enrolling) a factor through mfa.challenge/mfa.enroll and ' +
        'verifying the code through mfa.verify(), and persisting the resulting credentials through the SDK ' +
        '(the hook saves automatically on mfa.verify, or via saveCredentials()/credentialsManager.saveCredentials()) ' +
        'so the user finishes signing in?',
      undefined,
      {
        context:
          'the scaffold uses react-native-auth0 v5. useAuth0() exposes the mfa sub-client (an IMfaClient with ' +
          'getAuthenticators, enroll, challenge, verify) plus top-level loginWithPasswordRealm and ' +
          'saveCredentials -- it does NOT expose auth or credentialsManager. Both loginWithPasswordRealm and ' +
          'mfa.verify persist credentials automatically before resolving, so a correct hook solution may make ' +
          'no explicit save call. A passwordRealm MFA failure throws an AuthError with error.code === ' +
          '"mfa_required" and the token at error.json.mfa_token (untyped) -- this IS the real v5 API. The ' +
          'legacy direct step-up methods are authorizeWithOTP, authorizeWithOOB, authorizeWithRecoveryCode, and ' +
          'sendMultifactorChallenge. Grade the structural flow only -- do not mark correct v5 API usage as ' +
          'fabricated based on pre-v5 or web-SDK knowledge.',
      },
    ),
  ];
}
