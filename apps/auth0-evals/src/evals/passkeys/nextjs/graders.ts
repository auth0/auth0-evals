import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey symbols present (enrollment + login + signup) ──
    // Server-step API on the Auth0Client singleton (the scaffold exports `auth0`).
    // The one-call client wrappers (passkey.signup/login) are intentionally not
    // accepted — the qualified server methods are what the eval measures.
    contains(
      'auth0.passkey.register',
      'Requests a signup registration challenge via the server passkey client',
      GraderLevel.L1,
    ),
    contains('auth0.passkey.challenge', 'Requests a login challenge via the server passkey client', GraderLevel.L1),
    contains(
      'auth0.passkey.getToken',
      'Exchanges the login/signup credential for a session via getToken',
      GraderLevel.L1,
    ),
    contains(
      'auth0.passkey.enrollmentChallenge',
      'Requests an enrollment challenge for the signed-in user (MyAccount)',
      GraderLevel.L1,
    ),
    contains(
      'auth0.passkey.enrollmentVerify',
      'Completes enrollment for the signed-in user via enrollmentVerify',
      GraderLevel.L1,
    ),
    // The SDK does not run the ceremony — the browser must drive the platform
    // authenticator itself and serialize the result with the SDK helper.
    contains('navigator.credentials', 'Runs the WebAuthn ceremony in the browser', GraderLevel.L1),
    contains('serializeCredential', 'Serializes the credential with the SDK helper', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    // The SDKs call navigator.credentials directly and ship their own base64url
    // helpers — @simplewebauthn double-encodes and breaks the token exchange.
    notContains('@simplewebauthn', 'Does not pull in @simplewebauthn (SDK ships its own helpers)', GraderLevel.L2),
    // The correct grant is urn:okta:params:oauth:grant-type:webauthn, set by the
    // SDK internally; the urn:ietf: form means the model hand-rolled the exchange.
    notContains(
      'urn:ietf:params:oauth:grant-type:webauthn',
      'Does not use the wrong (ietf) webauthn grant string',
      GraderLevel.L2,
    ),
    // The SDK owns the MyAccount enrollment path internally; spelling it in source
    // means the model hand-rolled enrollment. Source-only + ignoreComments.
    notContainsInSource(
      '/me/v1/authentication-methods',
      'Does not hand-roll the raw MyAccount authentication-methods endpoint instead of the SDK',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    // The client secret is a real secret — it lives in the environment and is
    // read by the SDK server-side. It must never be spelled in source, and the
    // token exchange must stay on the server so it never reaches the browser.
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source (belongs in the environment)',
      GraderLevel.L3,
    ),
    judge(
      'Does the client secret and the token exchange stay entirely on the server — the secret read only from the ' +
        'environment in server code, and getToken / getTokenByPasskey called only server-side — so that no token or ' +
        'secret is ever shipped to browser JavaScript?',
      GraderLevel.L3,
    ),
    judge(
      'Are the WebAuthn challenge and the authSession passed to the browser and back taken from the SDK challenge ' +
        'objects (the register, challenge and enrollmentChallenge responses) rather than a hardcoded relying-party id ' +
        'or a fabricated or reused challenge or authSession?',
      GraderLevel.L3,
    ),
    judge(
      'Is the MyAccount access token used for enrollment obtained by the SDK itself from the signed-in session ' +
        '(via auth0.passkey.enrollmentChallenge, which exchanges the session internally) rather than passed in from ' +
        'the browser or hand-issued with a hardcoded token?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness (all three flows) ──────────────────────
    judge(
      'Does the signup follow the correct passkey ceremony in order: (1) call auth0.passkey.register on the server to ' +
        'get a registration challenge; (2) send it to the browser, decode authnParamsPublicKey and run ' +
        'navigator.credentials.create; (3) serialize the credential (serializeCredential) and send it plus authSession ' +
        'back to the server; (4) call auth0.passkey.getToken to establish the session?',
      GraderLevel.L4,
    ),
    judge(
      'Does the sign-in follow the correct passkey ceremony in order: (1) call auth0.passkey.challenge on the server ' +
        'to get a login challenge; (2) send it to the browser, decode authnParamsPublicKey and run ' +
        'navigator.credentials.get; (3) serialize the credential and send it plus authSession back to the server; ' +
        '(4) call auth0.passkey.getToken to establish the session?',
      GraderLevel.L4,
    ),
    judge(
      'Does the passkey enrollment for the already-signed-in user go through auth0.passkey.enrollmentChallenge and ' +
        'auth0.passkey.enrollmentVerify (with navigator.credentials.create in the browser between them), adding a ' +
        'passkey to the current account, rather than through the signup path (register / getToken) which would create ' +
        'a new account?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the whole feature built on the current @auth0/nextjs-auth0 server passkey API (auth0.passkey.register, ' +
        'challenge, getToken, enrollmentChallenge and enrollmentVerify) with navigator.credentials in the browser, ' +
        'rather than hand-built HTTP requests to the passkey or MyAccount endpoints, a third-party WebAuthn library, ' +
        'or a Universal Login redirect that never touches the passkey API?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add all three passkey flows to a Next.js App Router app using @auth0/nextjs-auth0 — ' +
        'enrollment for a signed-in user via auth0.passkey.enrollmentChallenge/enrollmentVerify, sign-in via ' +
        'auth0.passkey.challenge, and signup via auth0.passkey.register — running navigator.credentials in the browser ' +
        'and completing login and signup with auth0.passkey.getToken, keeping the client secret and token exchange ' +
        'server-side?',
    ),
  ];
}
