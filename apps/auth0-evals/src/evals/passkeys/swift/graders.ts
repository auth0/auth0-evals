import { contains, notContains, notContainsInSource, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey symbols present (enrollment + login + signup) ──
    // Authentication API — login (existing user) and signup (new user).
    contains(
      'passkeyLoginChallenge',
      'Requests a passkey login challenge from the Authentication client',
      GraderLevel.L1,
    ),
    contains(
      'passkeySignupChallenge',
      'Requests a passkey signup challenge from the Authentication client',
      GraderLevel.L1,
    ),
    // Swift infers the challenge type, so correct code often never spells out
    // PasskeyLoginChallenge — accept either the type name or the login(passkey:)
    // exchange that consumes it (used by both login and signup).
    matches(
      String.raw`PasskeyLoginChallenge|login\(\s*passkey:`,
      'Exchanges the login/signup credential via login(passkey:challenge:)',
      GraderLevel.L1,
    ),
    // MyAccount API — enrollment adds a passkey to the already-signed-in user's
    // account. The registration ceremony is shared with signup, so enrollment is
    // pinned on the MyAccount client and its own challenge and enroll methods.
    contains('myAccount(', 'Builds the MyAccount client to enroll a passkey for the current user', GraderLevel.L1),
    contains(
      'passkeyEnrollmentChallenge',
      'Requests a passkey enrollment challenge from the MyAccount client',
      GraderLevel.L1,
    ),
    contains('.enroll(', 'Completes enrollment via the MyAccount enroll call', GraderLevel.L1),
    // The SDK does not wrap the OS credential API — the app must drive the
    // platform authenticator through Apple AuthenticationServices itself.
    contains(
      'ASAuthorizationPlatformPublicKeyCredentialProvider',
      'Bridges to the platform authenticator via AuthenticationServices',
      GraderLevel.L1,
    ),
    contains('createCredentialAssertionRequest', 'Builds an assertion request for sign-in', GraderLevel.L1),
    contains(
      'createCredentialRegistrationRequest',
      'Builds a registration request for signup and enrollment',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('Auth0SDK', 'No hallucinated Auth0SDK package name (correct package is Auth0)', GraderLevel.L2),
    // The SDK exposes passkeyLoginChallenge/passkeySignupChallenge (no slash); a
    // literal /passkey/challenge path means the model hand-rolled the exchange
    // over raw HTTP instead of using the SDK.
    notContains(
      '/passkey/challenge',
      'Does not hand-roll the raw /passkey/challenge endpoint instead of the SDK',
      GraderLevel.L2,
    ),
    // The MyAccount client owns the /me/v1/authentication-methods path
    // internally; spelling it in source means the model hand-rolled enrollment.
    notContains(
      '/me/v1/authentication-methods',
      'Does not hand-roll the raw MyAccount authentication-methods endpoint instead of the MyAccount client',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in Swift source files (ok in Auth0.plist)',
      GraderLevel.L3,
      { ignoreComments: true },
    ),
    // The domain is not a secret (it is the public RP-id, ships in Auth0.plist
    // and the webcredentials entitlement, and the MyAccount audience string
    // legitimately embeds it) so it is not checked here — a hardcoded-domain
    // check false-positives on correct enrollment code.
    judge(
      'Are the relying-party identifier and challenge fed to the platform authenticator taken directly from ' +
        'the SDK challenge objects (relyingPartyId and challengeData on the login, signup and enrollment challenges), ' +
        'rather than a hardcoded relying-party string or a fabricated or reused challenge?',
      GraderLevel.L3,
    ),
    judge(
      'Is the access token used for passkey enrollment obtained specifically for the MyAccount API audience ' +
        '(the https://<domain>/me audience with the create:me:authentication_methods scope, exchanged from the ' +
        'stored credentials through the credentials manager apiCredentials call) rather than reusing the plain ' +
        'login access token or a hardcoded token?',
      GraderLevel.L3,
    ),
    judge(
      'Does the login and signup store the resulting Auth0 Credentials via CredentialsManager rather than ' +
        'persisting tokens (access tokens, ID tokens, refresh tokens) by hand in UserDefaults or the Keychain?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness (all three flows) ──────────────────────
    judge(
      'Does the sign-in follow the correct passkey ceremony in order: (1) obtain a PasskeyLoginChallenge via ' +
        'passkeyLoginChallenge; (2) build ASAuthorizationPlatformPublicKeyCredentialProvider with the login ' +
        "challenge's relyingPartyId and createCredentialAssertionRequest with the challenge's challengeData; " +
        '(3) run it through ASAuthorizationController performRequests with a delegate; (4) pass the resulting ' +
        'assertion to Authentication.login(passkey:challenge:) to obtain Credentials?',
      GraderLevel.L4,
    ),
    judge(
      'Does the signup follow the correct passkey ceremony in order: (1) obtain a PasskeySignupChallenge via ' +
        'passkeySignupChallenge with the new user details; (2) build ASAuthorizationPlatformPublicKeyCredentialProvider ' +
        "with the signup challenge's relyingPartyId and createCredentialRegistrationRequest with the challenge's " +
        'challengeData, userName and userId; (3) run it through ASAuthorizationController performRequests with a ' +
        'delegate; (4) pass the resulting registration to Authentication.login(passkey:challenge:) to obtain Credentials?',
      GraderLevel.L4,
    ),
    judge(
      'Does the passkey enrollment for the already-signed-in user follow the correct ceremony in order: (1) obtain a ' +
        'MyAccount-audience access token through the credentials manager and build the MyAccount client via ' +
        'myAccount(token:); (2) obtain a PasskeyEnrollmentChallenge via passkeyEnrollmentChallenge on its ' +
        'authenticationMethods; (3) build ASAuthorizationPlatformPublicKeyCredentialProvider with the enrollment ' +
        "challenge's relyingPartyId and createCredentialRegistrationRequest with its challengeData, userName and " +
        'userId, run through ASAuthorizationController performRequests with a delegate; (4) pass the resulting ' +
        'registration to enroll(passkey:challenge:) so the passkey is added to the current account rather than ' +
        'creating a new account through login(passkey:challenge:)?',
      GraderLevel.L4,
    ),
    judge(
      'Does the solution set up (or explicitly call out as required) the Associated Domains capability with a ' +
        'webcredentials entitlement for the Auth0 domain, without which the OS will refuse the passkey ceremony? ' +
        'An entitlements change or an explicit instruction to add it both count.',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    // Auth0.swift has no deprecated passkey symbols, so this only checks the
    // model used the SDK's passkey methods rather than reinventing the ceremony.
    judge(
      'Is the passkey exchange done through the SDK methods (passkeyLoginChallenge, passkeySignupChallenge and ' +
        'login(passkey:challenge:) on the Authentication client, and myAccount(token:) with passkeyEnrollmentChallenge ' +
        'and enroll(passkey:challenge:) for enrollment) rather than by hand-building HTTP requests to the passkey or ' +
        'MyAccount endpoints or pulling in a third-party WebAuthn library?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add all three passkey flows to a Swift iOS app — enrollment for a signed-in user ' +
        'through the MyAccount client (passkeyEnrollmentChallenge then enroll, using a MyAccount-audience token), ' +
        'sign-in via passkeyLoginChallenge, and signup via passkeySignupChallenge — driving the platform ' +
        "authenticator through Apple AuthenticationServices with each challenge's relying-party id and challenge, and " +
        'exchanging the login and signup ceremonies via login(passkey:challenge:) to obtain and store Credentials?',
    ),
  ];
}
