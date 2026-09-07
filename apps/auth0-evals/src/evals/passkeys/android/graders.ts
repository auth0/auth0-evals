import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey sign-in symbols present ──────────────────────
    contains('passkeyChallenge', 'Requests a passkey sign-in challenge from AuthenticationAPIClient', GraderLevel.L1),
    contains('signinWithPasskey', 'Exchanges the platform credential for Auth0 credentials', GraderLevel.L1),
    // The SDK does not wrap the OS credential API — the app must drive the
    // platform authenticator through AndroidX CredentialManager itself.
    contains(
      'GetPublicKeyCredentialOption',
      'Builds a get-credential option (sign-in), not a create-credential request',
      GraderLevel.L1,
    ),
    // Required on every signinWithPasskey call — without it ID token claim
    // validation is silently skipped (see L3).
    contains('validateClaims', 'Chains validateClaims on the sign-in request', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('auth0-java', 'No auth0-java (server-side SDK, not for Android)', GraderLevel.L2),
    // The SDK uses only AndroidX androidx.credentials; the older Google Play
    // Services FIDO API is the wrong, lower-level path.
    notContains(
      'com.google.android.gms.fido',
      'Does not use the deprecated Google Play Services FIDO API instead of CredentialManager',
      GraderLevel.L2,
    ),
    // The SDK exposes passkeyChallenge/signinWithPasskey (no slash); a literal
    // /passkey/challenge path means the model hand-rolled the Auth0 exchange
    // over raw HTTP instead of using the SDK — observed in baseline runs.
    notContains(
      '/passkey/challenge',
      'Does not hand-roll the raw /passkey/challenge endpoint instead of the SDK',
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
      'Is validateClaims() actually chained on the signinWithPasskey request before it is started/awaited, so ' +
        'ID token claims (issuer, audience, nonce, expiry) are validated? Omitting it makes the SDK skip that ' +
        'validation with only a warning, which is a security defect.',
      GraderLevel.L3,
    ),
    judge(
      'Is the CredentialManager get-request built from the challenge object returned by Auth0 ' +
        '(challenge.authParamsPublicKey and challenge.authSession) rather than a hardcoded relying-party id or a ' +
        'fabricated/reused challenge, and is the PublicKeyCredentials obtained from the platform authenticator ' +
        'rather than constructed by hand?',
      GraderLevel.L3,
    ),
    judge(
      'Does the code let SecureCredentialsManager (or CredentialsManager) store the Credentials returned from the ' +
        'passkey sign-in rather than persisting Auth0 tokens (access tokens, ID tokens, refresh tokens) by hand ' +
        'in SharedPreferences? Storing only application/UI state is acceptable — only manual token storage is a ' +
        'violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    judge(
      'Does the sign-in follow the correct passkey ceremony in order: (1) obtain a PasskeyChallenge via ' +
        'passkeyChallenge; (2) build GetPublicKeyCredentialOption from the JSON of challenge.authParamsPublicKey ' +
        'wrapped in a GetCredentialRequest; (3) call credentialManager.getCredential and read the ' +
        'authenticationResponseJson from the returned PublicKeyCredential; (4) pass it plus challenge.authSession ' +
        'to signinWithPasskey(...).validateClaims() to obtain Credentials, which are then saved via the ' +
        'credentials manager?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    // PasskeyAuthProvider was deprecated in v3; PasskeyProvider and
    // PasskeyManager were removed in v4 (V4_MIGRATION_GUIDE.md). The current
    // path is AuthenticationAPIClient + AndroidX CredentialManager directly.
    notContains('PasskeyAuthProvider', 'Does not use the removed PasskeyAuthProvider wrapper', GraderLevel.L5),
    notContains('PasskeyProvider', 'Does not use the removed PasskeyProvider wrapper', GraderLevel.L5),
    notContains('PasskeyManager', 'Does not use the removed PasskeyManager wrapper', GraderLevel.L5),
    judge(
      'Is the passkey sign-in built with the current API — AuthenticationAPIClient (passkeyChallenge / ' +
        'signinWithPasskey) combined directly with AndroidX CredentialManager — rather than the removed ' +
        'PasskeyAuthProvider/PasskeyProvider/PasskeyManager wrappers or the Google Play Services FIDO2 API?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add passkey sign-in to an Android app — requesting a challenge via ' +
        'passkeyChallenge, driving the platform authenticator through AndroidX CredentialManager with the ' +
        "challenge's authParamsPublicKey, and exchanging the resulting PublicKeyCredential back via " +
        'signinWithPasskey(...).validateClaims() to obtain and store Credentials?',
    ),
  ];
}
