import { contains, matches, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey symbols present ──────────────────────────────
    contains('@auth0/auth0-spa-js', 'Uses @auth0/auth0-spa-js SDK', GraderLevel.L1),
    // Sign-up: the one-call passkey.signup() or the granular getSignupChallenge().
    matches(
      String.raw`passkey\.signup|getSignupChallenge`,
      'Registers a passkey via the SDK — passkey.signup() or the granular getSignupChallenge()',
      GraderLevel.L1,
    ),
    // Sign-in: the one-call passkey.login() or the granular getLoginChallenge().
    matches(
      String.raw`passkey\.login|getLoginChallenge`,
      'Authenticates with a passkey via the SDK — passkey.login() or the granular getLoginChallenge()',
      GraderLevel.L1,
    ),
    // Passkey login sets no Auth0 session cookie, so silent renewal needs a
    // refresh token — the SDK requires useRefreshTokens for passkey sessions.
    contains(
      'useRefreshTokens',
      'Enables useRefreshTokens — required for passkey sessions (no session cookie is set)',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    // In-source (skips .md/.json/.env): an agent design note that merely mentions
    // a term — "we do NOT use @auth0/auth0-react here" — is not a hallucination.
    notContainsInSource('@auth0/auth0-react', 'No React SDK in a vanilla JS app', GraderLevel.L2),
    notContainsInSource('@auth0/auth0-vue', 'No Vue SDK in a vanilla JS app', GraderLevel.L2),
    notContainsInSource('@auth0/nextjs-auth0', 'No Next.js SDK in a vanilla JS app', GraderLevel.L2),
    notContainsInSource(
      '@simplewebauthn',
      'No third-party WebAuthn library — the SDK drives the ceremony',
      GraderLevel.L2,
    ),
    // The SDK sends the WebAuthn grant on the token exchange internally; writing
    // the URN means the model hand-built /oauth/token instead of using the SDK.
    notContainsInSource(
      'urn:okta:params:oauth:grant-type:webauthn',
      'Does not hand-build the WebAuthn token-exchange grant — the SDK sends it internally',
      GraderLevel.L2,
    ),
    notContainsInSource(
      '/passkey/challenge',
      'Does not hand-roll the raw passkey challenge endpoint instead of the SDK',
      GraderLevel.L2,
    ),
    notContainsInSource('client_secret', 'No client_secret in an SPA (public client)', GraderLevel.L2),

    // ── L3: Security ──────────────────────────────────────────────────────
    judge(
      'Does the code avoid manually storing Auth0 tokens (access tokens, ID tokens, refresh tokens) or the ' +
        'passkey auth_session/authSession in localStorage or sessionStorage? The SDK caches tokens itself; ' +
        'storing only application/UI state is acceptable — only manual token or auth-session storage is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    matches(
      String.raw`useRefreshTokens\s*:\s*true`,
      'useRefreshTokens: true set on the Auth0 client (required for passkey silent renewal)',
      GraderLevel.L4,
    ),
    judge(
      'Are both passkey sign-up and passkey sign-in wired to distinct UI triggers, each calling the SDK — ' +
        'auth0.passkey.signup(...) and auth0.passkey.login(...), or the equivalent granular ' +
        'getSignupChallenge / getLoginChallenge + getTokenWithPasskey flow — and awaited?',
      GraderLevel.L4,
    ),
    judge(
      'After a successful passkey sign-up or sign-in, does the code refresh the UI by reading the resulting ' +
        'session through the SDK (isAuthenticated(), getUser(), or getTokenSilently()) rather than assuming the ' +
        'returned tokens must be persisted and handled by hand?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    contains(
      'authorizationParams',
      'Uses authorizationParams (current v2 API, not deprecated top-level options)',
      GraderLevel.L5,
    ),
    judge(
      'Is the passkey flow implemented through the SDK passkey methods (auth0.passkey.signup / passkey.login, or ' +
        'the granular getSignupChallenge / getLoginChallenge / getTokenWithPasskey) rather than by hand-building ' +
        'the WebAuthn ceremony and a raw /oauth/token exchange, or by pulling in a third-party WebAuthn library?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add passwordless passkey authentication to a vanilla JavaScript SPA using ' +
        '@auth0/auth0-spa-js — letting a new user sign up with a passkey (auth0.passkey.signup) and an existing ' +
        'user sign in with a passkey (auth0.passkey.login), with useRefreshTokens: true configured on the client ' +
        'so the passkey session can be silently renewed?',
    ),
  ];
}
