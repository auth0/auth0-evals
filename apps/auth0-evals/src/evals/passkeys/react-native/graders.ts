import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey symbols present (enrollment + login + signup) ──
    // Authentication client — login (existing user) and signup (new user).
    // The same methods are exposed on the Auth0 class and on the useAuth0 hook.
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
    // getTokenByPasskey finishes BOTH the login and signup ceremonies — it is the
    // single token-exchange call that turns the native credential into Credentials.
    contains(
      'getTokenByPasskey',
      'Exchanges the login/signup credential for tokens via getTokenByPasskey',
      GraderLevel.L1,
    ),
    // MyAccount API — enrollment adds a passkey to the already-signed-in user's
    // account. Pinned on the myAccount client and its own challenge/enroll methods.
    contains('myAccount', 'Uses the myAccount client to enroll a passkey for the current user', GraderLevel.L1),
    contains(
      'passkeyEnrollmentChallenge',
      'Requests a passkey enrollment challenge from the myAccount client',
      GraderLevel.L1,
    ),
    contains('enrollPasskey', 'Completes enrollment via the myAccount enrollPasskey call', GraderLevel.L1),
    // The SDK does not run the WebAuthn ceremony — the app must feed the challenge's
    // authParamsPublicKey to the platform authenticator and send the result back.
    contains(
      'authParamsPublicKey',
      'Drives the native ceremony with the challenge authParamsPublicKey from the SDK',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    // signupWithPasskey / loginWithPasskey are the Auth0.Android one-call method
    // names — they do NOT exist in react-native-auth0, whose flow is
    // challenge → native ceremony → getTokenByPasskey. Their presence means the
    // model crossed SDKs.
    notContains(
      'signupWithPasskey',
      'Does not call the nonexistent signupWithPasskey (that is the Android SDK, not react-native-auth0)',
      GraderLevel.L2,
    ),
    notContains(
      'loginWithPasskey',
      'Does not call the nonexistent loginWithPasskey (that is the Android SDK, not react-native-auth0)',
      GraderLevel.L2,
    ),
    // The one-call passkey client (passkey.signup / passkey.login) lives in the
    // browser SDK @auth0/auth0-react — pulling it into a React Native app is the
    // wrong SDK; react-native-auth0 provides the passkey flow natively.
    notContains(
      '@auth0/auth0-react',
      'Does not pull in the browser SDK @auth0/auth0-react (react-native-auth0 owns the passkey flow)',
      GraderLevel.L2,
    ),
    // The SDK exposes passkeyLoginChallenge/passkeySignupChallenge (no slash); a
    // literal /passkey/challenge path in source means the model hand-rolled the
    // Auth0 exchange over raw HTTP instead of using the SDK. Source-only +
    // ignoreComments so the path mentioned in a code comment does not trip it.
    notContainsInSource(
      '/passkey/challenge',
      'Does not hand-roll the raw /passkey/challenge endpoint instead of the SDK',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    // The myAccount client owns the /me/v1/authentication-methods path internally;
    // spelling it in source means the model hand-rolled the enrollment exchange.
    notContainsInSource(
      '/me/v1/authentication-methods',
      'Does not hand-roll the raw MyAccount authentication-methods endpoint instead of the myAccount client',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    // The client ID and domain are public config, not secrets — they ship in the
    // app bundle and react-native-auth0 documents constructing the provider with
    // them directly — so a hardcoded-value L3 check false-positives on correct
    // code. L3 here is about real credential handling: using SDK challenges,
    // scoping the MyAccount token, and letting the SDK hold the tokens.
    judge(
      'Are the WebAuthn parameters fed to the platform authenticator taken directly from the SDK challenge objects ' +
        '(the authParamsPublicKey and authSession returned by passkeyLoginChallenge, passkeySignupChallenge and ' +
        'passkeyEnrollmentChallenge) rather than a hardcoded relying-party id or a fabricated or reused challenge, ' +
        'and is the credential sent back obtained from the device authenticator rather than constructed by hand?',
      GraderLevel.L3,
    ),
    judge(
      'Is the access token used for passkey enrollment obtained specifically for the MyAccount API audience ' +
        '(the https://<custom-domain>/me/ audience with the create:me:authentication_methods scope) rather than ' +
        'reusing the plain login access token or a hardcoded token?',
      GraderLevel.L3,
    ),
    judge(
      'Does the sign-in and signup let react-native-auth0 hold the Credentials returned from getTokenByPasskey ' +
        '(via the SDK credentials manager / useAuth0 state) rather than persisting tokens (access, ID or refresh ' +
        'tokens) by hand in AsyncStorage or another plaintext store?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness (all three flows) ──────────────────────
    // Each flow is split into its atomic ceremony steps (obtain challenge →
    // finalize exchange) rather than one compound "(1)(2)(3)(4) in order" judge,
    // so a partially-wired flow earns partial credit and the failing step is
    // pinpointed. The shared ceremony step is graded once by the platform-split
    // judge below.
    judge(
      'Does the sign-in path obtain a login challenge via passkeyLoginChallenge (on the Authentication client or ' +
        'the useAuth0 hook) before running the ceremony?',
      GraderLevel.L4,
    ),
    judge(
      'Does the sign-in path pass the credential produced by the WebAuthn ceremony, together with the challenge ' +
        'authSession, to getTokenByPasskey to obtain Credentials?',
      GraderLevel.L4,
    ),
    judge(
      "Does the signup path obtain a signup challenge via passkeySignupChallenge with the new user's details " +
        '(such as email) before running the ceremony?',
      GraderLevel.L4,
    ),
    judge(
      'Does the signup path pass the credential produced by the WebAuthn registration ceremony, together with the ' +
        'challenge authSession, to getTokenByPasskey to obtain Credentials?',
      GraderLevel.L4,
    ),
    judge(
      'Does the enrollment path obtain a MyAccount-audience access token, build the myAccount client, and request a ' +
        'challenge via passkeyEnrollmentChallenge before running the ceremony?',
      GraderLevel.L4,
    ),
    judge(
      'Does the enrollment path pass the credential produced by the WebAuthn registration ceremony, with the ' +
        'challenge authSession (and authenticationMethodId), to enrollPasskey so the passkey is ADDED to the current ' +
        'account rather than creating a new one via getTokenByPasskey?',
      GraderLevel.L4,
    ),
    // The SDK methods are identical across platforms; only the ceremony between
    // the challenge and the token/enroll call differs. A solution that targets
    // both native and web must branch it correctly.
    judge(
      'Does the WebAuthn ceremony branch correctly by platform — on iOS and Android running the challenge through ' +
        'a native passkey module (such as react-native-passkey or a native module), and on web calling ' +
        'navigator.credentials.create (for signup/enrollment) and navigator.credentials.get (for sign-in) with the ' +
        "challenge's authParamsPublicKey — and is the resulting credential handed to getTokenByPasskey/enrollPasskey " +
        'as authResponse (the raw PublicKeyCredential on web, the serialized result from the native module on ' +
        'iOS/Android)?',
      GraderLevel.L4,
    ),
    judge(
      'Does the solution use the custom domain (auth.barkbook.com) on the Auth0Provider and set up — or explicitly ' +
        'call out as required — the platform association that passkeys need (an iOS Associated Domains ' +
        'webcredentials entry and/or an Android Digital Asset Links assetlinks file for the Auth0 domain), without ' +
        'which the OS refuses the passkey ceremony? A config change or an explicit instruction to add it both count.',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    // The passkey API is new in react-native-auth0 v5.7.0; there are no
    // deprecated passkey symbols, so this checks the model used the SDK's passkey
    // methods rather than a wrong-SDK wrapper or a hand-built exchange.
    judge(
      'Is the passkey exchange done through the current react-native-auth0 methods (passkeyLoginChallenge, ' +
        'passkeySignupChallenge and getTokenByPasskey on the Authentication client, and the myAccount client with ' +
        'passkeyEnrollmentChallenge and enrollPasskey for enrollment) rather than the Android-SDK one-call ' +
        'signupWithPasskey/loginWithPasskey names, the browser SDK passkey.signup/passkey.login client, or ' +
        'hand-built HTTP requests to the passkey or MyAccount endpoints?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add all three passkey flows to a React Native app using react-native-auth0 — ' +
        'enrollment for a signed-in user through the myAccount client (passkeyEnrollmentChallenge then enrollPasskey, ' +
        'using a MyAccount-audience token), sign-in via passkeyLoginChallenge, and signup via passkeySignupChallenge — ' +
        "running the WebAuthn ceremony with each challenge's authParamsPublicKey (a native passkey module on " +
        'iOS/Android and navigator.credentials on web) and finalizing the sign-in and signup exchanges via ' +
        'getTokenByPasskey to obtain and store Credentials through the SDK?',
      undefined,
      {
        context:
          'the scaffold uses react-native-auth0 ^5.0.0, which resolves to the passkey-capable 5.7.0+ line. ' +
          'The Authentication client AND the useAuth0 hook both expose passkeyLoginChallenge, ' +
          'passkeySignupChallenge and getTokenByPasskey; enrollment uses the myAccount client ' +
          '(myAccount.passkeyEnrollmentChallenge and myAccount.enrollPasskey). Challenge responses carry ' +
          'authSession and authParamsPublicKey, and the token/enroll calls take an authResponse (the credential ' +
          'from the device). CRITICAL: react-native-auth0 does NOT run the WebAuthn ceremony itself — its own ' +
          'EXAMPLES.md tells the developer to use a passkey module such as react-native-passkey, a native module, ' +
          'or (on web) navigator.credentials for the create/get ceremony between the challenge and the token/enroll ' +
          'call. So using react-native-passkey or navigator.credentials for the ceremony is CORRECT and MUST NOT be ' +
          'flagged as hand-rolling or as a hallucinated dependency. On web the raw PublicKeyCredential is passed as ' +
          'authResponse; on native the serialized credential from the module is passed. PasskeyError (and ' +
          'PasskeyErrorCodes) are real error types exported from react-native-auth0 and used in the SDK examples, so ' +
          'catching PasskeyError is correct. These methods, fields and types are real, not fabricated. Grade the ' +
          'integration, not whether the symbols exist.',
      },
    ),
  ];
}
