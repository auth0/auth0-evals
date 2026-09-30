import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey symbols present (enrollment + login + signup) ──
    // Authentication API — login (existing user) and signup (new user).
    contains('passkeyChallenge', 'Requests a passkey sign-in challenge from AuthenticationAPIClient', GraderLevel.L1),
    contains('signupWithPasskey', 'Requests a passkey registration challenge for a new user', GraderLevel.L1),
    contains('signinWithPasskey', 'Exchanges the platform credential for Auth0 credentials', GraderLevel.L1),
    // MyAccount API — enrollment adds a passkey to the already-signed-in user's
    // account. The registration (create) ceremony is shared with signup, so
    // enrollment is pinned on the MyAccount client and its own challenge method.
    contains(
      'MyAccountAPIClient',
      'Uses the MyAccount API client to enroll a passkey for the current user',
      GraderLevel.L1,
    ),
    contains(
      'passkeyEnrollmentChallenge',
      'Requests a passkey enrollment challenge from the MyAccount client',
      GraderLevel.L1,
    ),
    contains('.enroll(', 'Completes enrollment via the MyAccount enroll call', GraderLevel.L1),
    // The SDK does not wrap the OS credential API — the app must drive the
    // platform authenticator through AndroidX CredentialManager itself.
    contains('GetPublicKeyCredentialOption', 'Builds a get-credential option for sign-in', GraderLevel.L1),
    contains(
      'CreatePublicKeyCredentialRequest',
      'Builds a create-credential request for signup and enrollment',
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
    // The SDK exposes passkeyChallenge/signupWithPasskey/signinWithPasskey (no
    // slash); a literal /passkey/challenge path in source means the model
    // hand-rolled the Auth0 exchange over raw HTTP instead of using the SDK —
    // observed in baseline runs. Source-only + ignoreComments so the path
    // mentioned in a code comment does not trip it.
    notContainsInSource(
      '/passkey/challenge',
      'Does not hand-roll the raw /passkey/challenge endpoint instead of the SDK',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    // MyAccountAPIClient owns the /me/v1/authentication-methods path internally;
    // spelling it in source means the model hand-rolled the enrollment exchange.
    notContainsInSource(
      '/me/v1/authentication-methods',
      'Does not hand-roll the raw MyAccount authentication-methods endpoint instead of MyAccountAPIClient',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    // The client ID and domain are public config, not secrets — they ship in
    // the app binary and Auth0.Android documents constructing the client with
    // them directly — so a hardcoded-value L3 check false-positives on correct
    // code. L3 here is about real credential handling: claim validation, using
    // SDK challenges, and storing tokens through the credentials manager.
    judge(
      'Is validateClaims() actually chained on the signinWithPasskey request for both the sign-in and the signup ' +
        'exchange before it is started or awaited, so ID token claims (issuer, audience, nonce, expiry) are ' +
        'validated? Omitting it makes the SDK skip that validation with only a warning, which is a security defect.',
      GraderLevel.L3,
    ),
    judge(
      'Are the CredentialManager requests built from the challenge objects returned by Auth0 ' +
        '(the authParamsPublicKey and authSession from passkeyChallenge for sign-in, from signupWithPasskey for ' +
        'signup, and from passkeyEnrollmentChallenge for enrollment) rather than a hardcoded relying-party id or a ' +
        'fabricated or reused challenge, and are the PublicKeyCredentials obtained from the platform authenticator ' +
        'rather than constructed by hand?',
      GraderLevel.L3,
    ),
    judge(
      'Is the access token passed to MyAccountAPIClient for passkey enrollment obtained specifically for the ' +
        'MyAccount API audience (the https://<domain>/me audience with the create:me:authentication_methods scope, ' +
        'exchanged from the stored refresh token through the credentials manager getApiCredentials call) rather than ' +
        'reusing the plain login access token or a hardcoded token?',
      GraderLevel.L3,
    ),
    judge(
      'Does the sign-in and signup store the resulting Auth0 Credentials via SecureCredentialsManager (or ' +
        'CredentialsManager) rather than persisting tokens (access tokens, ID tokens, refresh tokens) by hand ' +
        'in SharedPreferences?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness (all three flows) ──────────────────────
    judge(
      'Does the sign-in follow the correct passkey ceremony in order: (1) obtain a PasskeyChallenge via ' +
        'passkeyChallenge; (2) build GetPublicKeyCredentialOption from the JSON of challenge.authParamsPublicKey ' +
        'wrapped in a GetCredentialRequest; (3) call credentialManager.getCredential and read the ' +
        'authenticationResponseJson from the returned PublicKeyCredential; (4) pass that authentication response — ' +
        'either as the JSON string or as a PublicKeyCredentials parsed from it — plus challenge.authSession ' +
        'to signinWithPasskey(...).validateClaims() to obtain Credentials, which are then saved via the ' +
        'credentials manager?',
      GraderLevel.L4,
    ),
    judge(
      'Does the signup follow the correct passkey ceremony in order: (1) obtain a PasskeyRegistrationChallenge via ' +
        'signupWithPasskey with the new user data; (2) build CreatePublicKeyCredentialRequest from the JSON of ' +
        'challenge.authParamsPublicKey; (3) call credentialManager.createCredential and read the ' +
        'registrationResponseJson from the returned CreatePublicKeyCredentialResponse; (4) pass it plus ' +
        'challenge.authSession to signinWithPasskey(...).validateClaims() to obtain Credentials, which are then ' +
        'saved via the credentials manager?',
      GraderLevel.L4,
    ),
    judge(
      'Does the passkey enrollment for the already-signed-in user follow the correct ceremony in order: (1) exchange ' +
        'the stored refresh token for a MyAccount-audience access token through the credentials manager and build a ' +
        'MyAccountAPIClient with it; (2) obtain a PasskeyEnrollmentChallenge via passkeyEnrollmentChallenge; ' +
        '(3) build CreatePublicKeyCredentialRequest from the JSON of the enrollment challenge authParamsPublicKey and ' +
        'call credentialManager.createCredential to get the registration response; (4) parse it into ' +
        'PublicKeyCredentials and pass it plus the enrollment challenge to enroll so the passkey is added to the ' +
        "current user's account rather than creating a new account through signupWithPasskey?",
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    // PasskeyAuthProvider was deprecated in v3; PasskeyProvider and
    // PasskeyManager were removed in v4 (V4_MIGRATION_GUIDE.md). The current
    // path is AuthenticationAPIClient + MyAccountAPIClient + AndroidX
    // CredentialManager directly.
    notContains('PasskeyAuthProvider', 'Does not use the removed PasskeyAuthProvider wrapper', GraderLevel.L5),
    notContains('PasskeyProvider', 'Does not use the removed PasskeyProvider wrapper', GraderLevel.L5),
    notContains('PasskeyManager', 'Does not use the removed PasskeyManager wrapper', GraderLevel.L5),
    judge(
      'Is the passkey sign-in, signup and enrollment built with the current API — AuthenticationAPIClient ' +
        '(passkeyChallenge, signupWithPasskey and signinWithPasskey) and MyAccountAPIClient (passkeyEnrollmentChallenge ' +
        'and enroll) combined directly with AndroidX CredentialManager — rather than the removed PasskeyAuthProvider, ' +
        'PasskeyProvider or PasskeyManager wrappers or the Google Play Services FIDO2 API?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add all three passkey flows to an Android app — enrollment for a signed-in user ' +
        'through MyAccountAPIClient (passkeyEnrollmentChallenge then enroll, using a MyAccount-audience token), ' +
        'sign-in via passkeyChallenge, and signup via signupWithPasskey — driving the platform authenticator through ' +
        "AndroidX CredentialManager with each challenge's authParamsPublicKey and finalizing the sign-in and signup " +
        'exchanges via signinWithPasskey(...).validateClaims() to obtain and store Credentials?',
    ),
  ];
}
