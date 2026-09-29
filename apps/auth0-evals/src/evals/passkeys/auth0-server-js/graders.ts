import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey symbols present (login + signup) ─────────────
    // The scaffold exports `serverClient`; the passkey client is reached as
    // serverClient.passkey. getToken (not the lower-level getTokenByPasskey) is
    // what persists the session — see L4.
    contains('serverClient.passkey.register', 'Requests a signup registration challenge', GraderLevel.L1),
    contains('serverClient.passkey.challenge', 'Requests a login challenge', GraderLevel.L1),
    contains(
      'serverClient.passkey.getToken',
      'Exchanges the credential and persists the session via getToken',
      GraderLevel.L1,
    ),
    contains('navigator.credentials', 'Runs the WebAuthn ceremony in the browser', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('@simplewebauthn', 'Does not pull in @simplewebauthn (SDK ships its own helpers)', GraderLevel.L2),
    notContains(
      'urn:ietf:params:oauth:grant-type:webauthn',
      'Does not use the wrong (ietf) webauthn grant string',
      GraderLevel.L2,
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source (belongs in the environment)',
      GraderLevel.L3,
    ),
    judge(
      'Is the ServerClient constructed with its clientSecret and its state-store secret read from the environment ' +
        '(so the session store stays encrypted) rather than hardcoded strings, and is the token exchange kept ' +
        'server-side rather than attempted from browser code?',
      GraderLevel.L3,
    ),
    judge(
      'Are the WebAuthn challenge and authSession sent to the browser and back taken from the SDK challenge objects ' +
        '(the register and challenge responses) and is the credential obtained from navigator.credentials, rather than ' +
        'a hardcoded relying-party id or a fabricated, reused, or hand-built challenge or credential?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness (both flows + session persistence) ─────
    judge(
      'Does the signup follow the correct passkey ceremony in order: (1) call serverClient.passkey.register to get a ' +
        'registration challenge; (2) in the browser, decode authnParamsPublicKey and run navigator.credentials.create; ' +
        '(3) base64url-serialize the credential and send it plus authSession back to the server; (4) call ' +
        'serverClient.passkey.getToken to establish the session?',
      GraderLevel.L4,
    ),
    judge(
      'Does the sign-in follow the correct passkey ceremony in order: (1) call serverClient.passkey.challenge to get a ' +
        'login challenge; (2) in the browser, decode authnParamsPublicKey and run navigator.credentials.get; (3) ' +
        'base64url-serialize the credential and send it plus authSession back to the server; (4) call ' +
        'serverClient.passkey.getToken to establish the session?',
      GraderLevel.L4,
    ),
    // The discriminator vs. auth0-auth-js: completing the exchange through the
    // low-level getTokenByPasskey "works" but never persists the session, so
    // getUser/getAccessToken/logout find nothing afterward.
    notContains(
      'getTokenByPasskey',
      'Does not drop to the low-level getTokenByPasskey, which skips session persistence',
      GraderLevel.L4,
      { ignoreComments: true },
    ),
    judge(
      'Does the passkey exchange go through serverClient.passkey.getToken so the session is persisted to the state ' +
        'store and is retrievable afterward via getUser / getAccessToken, rather than the lower-level ' +
        'getTokenByPasskey which returns raw tokens and leaves no session?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the feature built on the current @auth0/auth0-server-js passkey API (serverClient.passkey.register, ' +
        'challenge and getToken) with navigator.credentials in the browser, rather than hand-built HTTP requests to ' +
        'the passkey or token endpoints or a third-party WebAuthn library?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add passkey sign-in and signup to the auth0-server-js web app — ' +
        'serverClient.passkey.register for signup, serverClient.passkey.challenge for login, running ' +
        'navigator.credentials in the browser, and completing both with serverClient.passkey.getToken so the signed-in ' +
        'user ends up in the same server-side session, with the client secret kept server-side?',
    ),
  ];
}
