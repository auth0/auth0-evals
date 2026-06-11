import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Required v4 reactive MFA symbols present ──────────────────────
    contains('@auth0/nextjs-auth0/server', 'Uses v4 server import path', GraderLevel.L1),
    contains('@auth0/nextjs-auth0/client', 'Uses v4 client import path', GraderLevel.L1),
    contains('MfaRequiredError', 'Handles MfaRequiredError from the SDK', GraderLevel.L1),
    contains('challengeWithPopup', 'Resolves MFA via mfa.challengeWithPopup popup flow', GraderLevel.L1),
    contains('getAccessToken', 'Requests an access token to trigger the step-up check', GraderLevel.L1),
    contains('https://api.barkbook.com', 'Targets the protected API audience', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK (React/SPA flow must be absent) ──────
    notContains('@auth0/auth0-react', 'Does not use the React SPA SDK in a Next.js app', GraderLevel.L2),
    notContains('getAccessTokenSilently', 'Does not use the SPA silent-token method', GraderLevel.L2),
    notContains('getIdTokenClaims', 'Does not inspect amr via getIdTokenClaims (SPA pattern)', GraderLevel.L2),
    notContains('speakeasy', 'No server-side TOTP library (speakeasy)', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib)', GraderLevel.L2),
    notContains('@auth0/guardian', 'No fake Guardian client SDK referenced', GraderLevel.L2),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source files (ok in .env.local)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in .env.local)',
      GraderLevel.L3,
    ),
    judge(
      'Is the access token for https://api.barkbook.com obtained and used only on the server ' +
        '(in a route handler or server action via auth0.getAccessToken), and never returned to ' +
        'the browser, written into a client component, or stored in localStorage/sessionStorage/cookies ' +
        'by application code? Answer yes only if the raw access token never crosses to the client.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    judge(
      'Does the server-side code call auth0.getAccessToken for the protected audience, catch ' +
        'MfaRequiredError, and surface it to the client as an error response (e.g. a 403 with the ' +
        'mfa_required code) rather than crashing or ignoring it?',
      GraderLevel.L4,
    ),
    judge(
      'When the client receives the mfa_required signal, does it call mfa.challengeWithPopup ' +
        '(from @auth0/nextjs-auth0/client) to complete MFA in a popup, and then retry the ' +
        'server-side action so the transfer proceeds after MFA succeeds?',
      GraderLevel.L4,
    ),

    // ── L5: Current v4 API patterns (reactive, not proactive SPA flow) ────
    judge(
      'Does the solution use the v4 reactive MFA step-up flow — triggering MFA by requesting an ' +
        'access token and handling MfaRequiredError — rather than the React SPA proactive pattern ' +
        'of passing acr_values/max_age in authorization params and inspecting the amr claim? It ' +
        'should also use v4 /auth/ routes and Auth0Client, not v3 /api/auth/ routes.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement reactive MFA step-up for a sensitive Transfer Funds ' +
        'action in a Next.js App Router app: the server requests a token for the protected audience ' +
        'and handles MfaRequiredError, the client resolves MFA via a popup (mfa.challengeWithPopup) ' +
        'without a full-page redirect, the transfer proceeds after MFA, and the access token stays ' +
        'server-side?',
    ),
  ];
}
