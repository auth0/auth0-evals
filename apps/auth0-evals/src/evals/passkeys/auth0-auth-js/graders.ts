import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required passkey symbols present (login + signup) ─────────────
    // The scaffold exports `authClient`; the passkey client is reached as
    // authClient.passkey. register = signup challenge, challenge = login.
    contains('authClient.passkey.register', 'Requests a signup registration challenge', GraderLevel.L1),
    contains('authClient.passkey.challenge', 'Requests a login challenge', GraderLevel.L1),
    contains(
      'getTokenByPasskey',
      'Exchanges the passkey credential for tokens over the webauthn grant',
      GraderLevel.L1,
    ),
    // The SDK is platform-agnostic and never runs the ceremony — the caller must
    // drive the browser authenticator and pass back the serialized credential.
    contains('navigator.credentials', 'Runs the WebAuthn ceremony in the browser', GraderLevel.L1),
    contains('authSession', 'Threads the challenge authSession back into the token exchange', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('@simplewebauthn', 'Does not pull in @simplewebauthn (SDK ships its own helpers)', GraderLevel.L2),
    notContains(
      'urn:ietf:params:oauth:grant-type:webauthn',
      'Does not use the wrong (ietf) webauthn grant string',
      GraderLevel.L2,
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    // The client secret must stay in the environment — getTokenByPasskey needs a
    // confidential client, but the secret is never spelled in source.
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source (belongs in the environment)',
      GraderLevel.L3,
    ),
    judge(
      'Is the AuthClient constructed with its clientSecret read from the environment (making it a confidential client, ' +
        'which getTokenByPasskey requires) rather than a hardcoded secret string, and is the token exchange kept on ' +
        'the server rather than attempted from browser code?',
      GraderLevel.L3,
    ),
    judge(
      'Are the WebAuthn challenge and authSession sent to the browser and back taken from the SDK challenge objects ' +
        '(the register and challenge responses) and is the credential obtained from navigator.credentials, rather than ' +
        'a hardcoded relying-party id or a fabricated, reused, or hand-built challenge or credential?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness (both flows) ───────────────────────────
    judge(
      'Does the signup follow the correct passkey ceremony in order: (1) call authClient.passkey.register to get a ' +
        'registration challenge; (2) in the browser, decode authnParamsPublicKey and run navigator.credentials.create; ' +
        '(3) base64url-serialize the credential and send it plus authSession back to the service; (4) call ' +
        'authClient.passkey.getTokenByPasskey to obtain tokens?',
      GraderLevel.L4,
    ),
    judge(
      'Does the sign-in follow the correct passkey ceremony in order: (1) call authClient.passkey.challenge to get a ' +
        'login challenge; (2) in the browser, decode authnParamsPublicKey and run navigator.credentials.get; (3) ' +
        'base64url-serialize the credential and send it plus authSession back to the service; (4) call ' +
        'authClient.passkey.getTokenByPasskey to obtain tokens?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the feature built on the current @auth0/auth0-auth-js passkey API (authClient.passkey.register, challenge ' +
        'and getTokenByPasskey) with navigator.credentials in the browser, rather than hand-built HTTP requests to the ' +
        'passkey or token endpoints or a third-party WebAuthn library?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add passkey sign-in and signup to the auth0-auth-js service — ' +
        'authClient.passkey.register for signup, authClient.passkey.challenge for login, running ' +
        'navigator.credentials in the browser, and completing both with authClient.passkey.getTokenByPasskey against a ' +
        'confidential client whose secret stays server-side?',
    ),
  ];
}
