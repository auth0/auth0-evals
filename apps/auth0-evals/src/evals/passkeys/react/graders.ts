import { contains, notContains, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey symbols present ──────────────────────────────
    contains('@auth0/auth0-react', 'Uses @auth0/auth0-react SDK', GraderLevel.L1),
    // The browser SDK exposes the whole ceremony behind the `passkey` client on
    // useAuth0 — one awaited call per flow. Both sign-up and sign-in are asked
    // for, so both methods must appear.
    matches(String.raw`passkey\s*\.\s*signup`, 'Registers a new user via passkey.signup (sign-up)', GraderLevel.L1),
    matches(String.raw`passkey\s*\.\s*login`, 'Authenticates via passkey.login (sign-in)', GraderLevel.L1),
    // Passkey login sets no session cookie, so silent renewal needs refresh
    // tokens — the SDK requires Auth0Provider be configured with useRefreshTokens.
    contains('useRefreshTokens', 'Enables useRefreshTokens on Auth0Provider (required for passkeys)', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    // The one-call SDK methods run the WebAuthn ceremony internally; app code
    // that calls navigator.credentials itself has reinvented what the SDK does.
    notContains(
      'navigator.credentials',
      'Does not drive the WebAuthn ceremony by hand — the SDK does it internally',
      GraderLevel.L2,
    ),
    // The SDK sends the WebAuthn grant on the token exchange; a literal grant
    // URN in source means the model hand-built the /oauth/token request.
    notContains(
      'urn:okta:params:oauth:grant-type:webauthn',
      'Does not hand-build the WebAuthn token exchange (SDK owns the grant)',
      GraderLevel.L2,
    ),
    // A literal /passkey/challenge path means the model hand-rolled the Auth0
    // exchange over raw HTTP instead of using the SDK passkey client.
    notContains(
      '/passkey/challenge',
      'Does not hit the raw /passkey/challenge endpoint instead of the SDK',
      GraderLevel.L2,
    ),
    notContains(
      '@simplewebauthn',
      'No third-party WebAuthn library — the SDK provides the passkey flow',
      GraderLevel.L2,
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens stored in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens stored in sessionStorage', GraderLevel.L3),
    judge(
      'Does the code let the SDK hold the tokens returned from the passkey flow rather than manually ' +
        'persisting Auth0 access, ID, or refresh tokens (for example in localStorage, sessionStorage, or a ' +
        'cookie)? Storing only application or UI state is acceptable — only manual token storage is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    judge(
      'Is Auth0Provider configured with useRefreshTokens enabled (either useRefreshTokens={true} or the ' +
        'shorthand useRefreshTokens), which passkey authentication requires so getAccessTokenSilently can ' +
        'renew tokens without a session cookie?',
      GraderLevel.L4,
    ),
    judge(
      'Does the app add both passkey flows correctly: a sign-up path that calls passkey.signup with the new ' +
        "user's identifier (such as email) and a sign-in path that calls passkey.login, each awaited inside " +
        'error handling, and relying on the SDK to update isAuthenticated and user afterwards rather than ' +
        'threading tokens through by hand?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the passkey feature built on the current @auth0/auth0-react one-call passkey client ' +
        '(the passkey.signup / passkey.login methods from useAuth0) rather than by reconstructing the WebAuthn ' +
        'ceremony manually, calling navigator.credentials directly, or hand-building requests to the /passkey or ' +
        '/oauth/token endpoints?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add passkey sign-up and sign-in to a React app using @auth0/auth0-react — ' +
        'calling passkey.signup to register a new user and passkey.login to authenticate an existing one, with ' +
        'Auth0Provider configured with useRefreshTokens, and letting the SDK manage tokens and auth state?',
      undefined,
      {
        context:
          'the scaffold uses @auth0/auth0-react ^2.2.4, which resolves to 2.26.0+. That version exposes a ' +
          'passkey client on useAuth0 — const { passkey } = useAuth0(); passkey.signup({ email }) and ' +
          'passkey.login() — re-exported from @auth0/auth0-spa-js, and PasskeyError / PasskeyRegisterError are ' +
          'exported from @auth0/auth0-react. These APIs and the useRefreshTokens Auth0Provider prop are real, ' +
          'not fabricated. Grade the integration, not whether the symbols exist.',
      },
    ),
  ];
}
