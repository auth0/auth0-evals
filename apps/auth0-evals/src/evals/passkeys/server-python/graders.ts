import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey symbols present ──────────────────────────────
    // auth0-server-python is a "server-driven" passkey SDK: it owns the challenge
    // and the token exchange, the browser owns the WebAuthn ceremony in between.
    // Sign-up and sign-in each start with their own challenge call; both finish
    // through the same signin_with_passkey exchange.
    contains('passkey_signup_challenge', 'Requests a passkey sign-up challenge via the SDK', GraderLevel.L1),
    contains('passkey_login_challenge', 'Requests a passkey sign-in challenge via the SDK', GraderLevel.L1),
    contains(
      'signin_with_passkey',
      'Completes the ceremony and establishes the session via signin_with_passkey',
      GraderLevel.L1,
    ),
    contains(
      'PasskeyAuthResponse',
      'Wraps the browser credential in the SDK PasskeyAuthResponse type for the exchange',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    // signin_with_passkey sends the WebAuthn grant on the token exchange itself;
    // a literal grant URN in source means the model hand-built /oauth/token.
    // ignoreComments so a design note quoting the URN isn't treated as a call.
    notContainsInSource(
      'urn:okta:params:oauth:grant-type:webauthn',
      'Does not hand-build the WebAuthn token exchange — signin_with_passkey sends the grant internally',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    // Claims come off PasskeyLoginResult.state_data / get_user(), never by hand.
    notContains('jwt.decode', 'No manual JWT decoding — read claims through the SDK session', GraderLevel.L2),
    notContains(
      'base64.b64decode',
      'No manual base64 token/credential decoding — the SDK owns the exchange',
      GraderLevel.L2,
    ),
    // Auth0 verifies the WebAuthn credential; the server must not re-run the
    // verification with a FIDO2 library. Case-sensitive: prose says "FIDO2",
    // only an import writes lowercase `fido2`.
    notContainsInSource(
      'fido2',
      'No server-side FIDO2/WebAuthn verification library — Auth0 verifies the credential',
      GraderLevel.L2,
      { caseSensitive: true, ignoreComments: true },
    ),
    // The browser beat uses raw navigator.credentials, not a browser one-call
    // SDK — pulling in @auth0/auth0-spa-js is the wrong shape for a server app.
    notContainsInSource(
      '@auth0/auth0-spa-js',
      'No browser one-call passkey SDK — a server app drives the ceremony via ServerClient',
      GraderLevel.L2,
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded Auth0 client secret in source (allowed only in .env)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code keep the passkey auth_session and the SDK-issued tokens out of logs and long-term ' +
        'storage — relying on the SDK to persist the session (signin_with_passkey writes it to the state ' +
        'store) rather than logging the auth_session or manually persisting Auth0 access, ID, or refresh ' +
        'tokens? Note: the auth_session is a short-lived flow credential that must bridge the challenge and ' +
        'the token-exchange requests, so holding it briefly (in memory or a short-lived httpOnly cookie) to ' +
        'complete the ceremony is expected and correct — only logging it or persisting it long-term, or ' +
        'hand-persisting Auth0 tokens, is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project byte-compiles (compileall succeeds)', GraderLevel.L4),
    // Content-based: confirms the provided Auth0 config was externalised into the
    // workspace (conventionally .env), robust to whether the agent wrote it via a
    // tool or a shell heredoc.
    contains(
      'dev-barkbook.us.auth0.com',
      'Auth0 config (domain) externalised into the workspace, e.g. .env',
      GraderLevel.L4,
    ),
    // The two beats are wired: the exchange replays the auth_session the challenge
    // returned rather than minting its own.
    matches(
      String.raw`signin_with_passkey\s*\([\s\S]{0,300}auth_session`,
      'Exchanges the credential via signin_with_passkey using the auth_session from the challenge',
      GraderLevel.L4,
    ),
    judge(
      'Does the app implement both passkey flows server-side — a sign-up path that calls ' +
        'passkey_signup_challenge (with a PasskeyUserProfile for the new user) and a sign-in path that calls ' +
        'passkey_login_challenge — each returning the challenge auth_session and authn_params_public_key to ' +
        'the browser, and a completion step that calls signin_with_passkey with that auth_session and the ' +
        'browser credential (as a PasskeyAuthResponse) so the SDK establishes the session?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the passkey feature built on the current auth0-server-python ServerClient passkey methods ' +
        '(passkey_signup_challenge, passkey_login_challenge, signin_with_passkey) with the PasskeyAuthResponse ' +
        'and PasskeyUserProfile types, rather than by hand-building the WebAuthn token exchange, calling the ' +
        'raw /passkey or /oauth/token endpoints over HTTP, or verifying the WebAuthn credential on the server ' +
        'with a third-party FIDO2/WebAuthn library?',
      GraderLevel.L5,
    ),
    judge(
      "Does the code read the signed-in user's identity from the SDK — the PasskeyLoginResult.state_data " +
        '(the returned user claims / token set) or a subsequent get_user() — and let the SDK persist the ' +
        'session, rather than manually decoding the returned ID or access token (for example base64-decoding ' +
        'a segment or calling jwt.decode by hand)?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add passkey sign-up and sign-in to a framework-agnostic Python web app ' +
        'using auth0-server-python — requesting a challenge with passkey_signup_challenge for a new user and ' +
        'passkey_login_challenge for a returning one, letting the browser run the WebAuthn ceremony ' +
        '(navigator.credentials.create / get) over the returned authn_params_public_key, and completing each ' +
        'flow through signin_with_passkey, which exchanges the credential under the WebAuthn grant and ' +
        'persists the SDK session?',
      undefined,
      {
        context:
          'These are real APIs in the pinned auth0-server-python 1.0.0b17 — passkey_signup_challenge, ' +
          'passkey_login_challenge and signin_with_passkey on ServerClient, and the PasskeyAuthResponse / ' +
          'PasskeyUserProfile / PasskeyLoginResult types in auth0_server_python.auth_types. Grade the ' +
          'integration, not whether the symbols exist.',
      },
    ),
  ];
}
