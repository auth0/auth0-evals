import { contains, notContains, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('MfaRequiredError', 'MfaRequiredError imported from SDK', GraderLevel.L1),
    contains('getAccessToken', 'getAccessToken called to trigger mfa_required check', GraderLevel.L1),
    contains('instanceof MfaRequiredError', 'MfaRequiredError caught and identified', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('speakeasy', 'No server-side TOTP library (speakeasy) used', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib) used', GraderLevel.L2),
    notContains('@auth0/guardian', 'No fake Guardian client SDK referenced', GraderLevel.L2),
    notContains(
      'loginWithRedirect',
      'Does not use React SPA loginWithRedirect in a server-side Next.js app',
      GraderLevel.L2,
    ),
    notContains(
      'getIdTokenClaims',
      'Does not use React SPA getIdTokenClaims — reads session server-side',
      GraderLevel.L2,
    ),

    // ── L3: Security checks ──────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded Auth0 domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code avoid exposing Auth0 tokens (access tokens, ID tokens) to the browser — ' +
        'for example, not returning them from Server Components as props, not embedding them ' +
        'in client component state, and not sending them as JSON to the client?',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    judge(
      'Does the code call auth0.getAccessToken() with the API audience (https://api.barkbook.com) ' +
        'and wrap it in a try/catch that handles MfaRequiredError to trigger step-up authentication?',
      GraderLevel.L4,
    ),
    judge(
      'When MfaRequiredError is caught, does the code redirect the user to an MFA challenge — ' +
        'either via a redirect to a challenge page, using mfa.challengeWithPopup(), or an equivalent ' +
        'SDK-supported mechanism — rather than silently failing or exposing the mfa_token to the client?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    notContains('handleAuth', 'Does not use v3 handleAuth (v4 uses middleware)', GraderLevel.L5),
    notContains('/api/auth/', 'Does not use v3 route prefix /api/auth/ (v4 uses /auth/)', GraderLevel.L5),
    notContains('AUTH0_ISSUER_BASE_URL', 'Does not use v3 env var AUTH0_ISSUER_BASE_URL', GraderLevel.L5),
    judge(
      'Is MfaRequiredError imported from "@auth0/nextjs-auth0/server" (the correct v4 server import path) ' +
        'rather than from the root "@auth0/nextjs-auth0" package or a non-existent path?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up authentication in a Next.js App Router app ' +
        'using @auth0/nextjs-auth0 v4 — calling getAccessToken() with the API audience, catching ' +
        'MfaRequiredError when Auth0 requires MFA, directing the user through an MFA challenge, ' +
        'and gating the Transfer Funds action so it only proceeds after MFA is satisfied?',
    ),
  ];
}
