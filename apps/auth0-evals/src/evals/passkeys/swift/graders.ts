import { contains, notContains, notContainsInSource, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey symbols present (login + signup) ─────────────
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
      'Exchanges the credential via login(passkey:challenge:)',
      GraderLevel.L1,
    ),
    // The SDK does not wrap the OS credential API — the app must drive the
    // platform authenticator through Apple AuthenticationServices itself.
    contains(
      'ASAuthorizationPlatformPublicKeyCredentialProvider',
      'Bridges to the platform authenticator via AuthenticationServices',
      GraderLevel.L1,
    ),
    contains('createCredentialAssertionRequest', 'Builds an assertion request for sign-in', GraderLevel.L1),
    contains('createCredentialRegistrationRequest', 'Builds a registration request for signup', GraderLevel.L1),

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
      'Are the relying-party identifier and challenge fed to the platform authenticator taken directly from ' +
        'the SDK challenge objects (relyingPartyId and challengeData on both the login and signup challenges), ' +
        'rather than a hardcoded relying-party string or a fabricated or reused challenge?',
      GraderLevel.L3,
    ),
    judge(
      'Does the code let CredentialsManager store the Credentials returned from the passkey login and signup rather ' +
        'than persisting Auth0 tokens (access tokens, ID tokens, refresh tokens) by hand in UserDefaults or the ' +
        'Keychain? Storing only application or UI state is acceptable, and only manual token storage is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness (both ceremonies) ──────────────────────
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
      'Does the solution set up (or explicitly call out as required) the Associated Domains capability with a ' +
        'webcredentials entitlement for the Auth0 domain, without which the OS will refuse the passkey ceremony? ' +
        'An entitlements change or an explicit instruction to add it both count.',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    // Auth0.swift has no deprecated passkey symbols, so this only checks the
    // model used the SDK's passkey methods rather than reinventing the ceremony.
    judge(
      'Is the passkey exchange done through the SDK Authentication client methods (passkeyLoginChallenge, ' +
        'passkeySignupChallenge and login(passkey:challenge:)) rather than by hand-building HTTP requests to the ' +
        'passkey authentication endpoints or pulling in a third-party WebAuthn library?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add both passkey sign-in and passkey signup to a Swift iOS app — requesting ' +
        'login and signup challenges from the Auth0 Authentication client, driving the platform authenticator ' +
        'through Apple AuthenticationServices with the relying-party id and challenge from those objects, and ' +
        'exchanging the resulting assertion and registration back via login(passkey:challenge:) to obtain and ' +
        'store Credentials?',
    ),
  ];
}
