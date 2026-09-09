import { contains, notContains, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('MfaRequiredError', 'Detects the mfa_required signal via MfaRequiredError', GraderLevel.L1),
    contains(
      'getAccessToken',
      'Requests the access token via getAccessToken to trigger the MFA challenge',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('speakeasy', 'No server-side TOTP library (speakeasy) used', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib) used', GraderLevel.L2),
    notContains('@auth0/guardian', 'No fake Guardian client SDK referenced', GraderLevel.L2),
    notContains('mfa/challenge', 'Does not call raw MFA challenge endpoint', GraderLevel.L2),
    notContains(
      'loginWithRedirect',
      'Does not use React SPA loginWithRedirect in a server-side Next.js app',
      GraderLevel.L2,
    ),
    notContains(
      'getIdTokenClaims',
      'Does not use the React SPA getIdTokenClaims in a server-side Next.js app',
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
      'Does the code call getAccessToken (e.g. with { refresh: true }) for the sensitive operation and ' +
        'catch the resulting MfaRequiredError to detect that step-up is required before allowing the ' +
        'transfer to proceed?',
      GraderLevel.L4,
    ),
    judge(
      'When MfaRequiredError is raised, does the code drive the user through an MFA challenge — e.g. ' +
        'mfa.challengeWithPopup() or a redirect to an /mfa-challenge route — rather than proceeding or ' +
        'simply returning an error?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    notContains('handleAuth', 'Does not use v3 handleAuth (v4 uses middleware)', GraderLevel.L5),
    notContains('/api/auth/', 'Does not use v3 route prefix /api/auth/ (v4 uses /auth/)', GraderLevel.L5),
    notContains('AUTH0_ISSUER_BASE_URL', 'Does not use v3 env var AUTH0_ISSUER_BASE_URL', GraderLevel.L5),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up authentication in a Next.js App Router app ' +
        'using @auth0/nextjs-auth0 v4 — calling getAccessToken for the sensitive operation, catching ' +
        'MfaRequiredError to detect that MFA is required, driving the user through an MFA challenge ' +
        '(mfa.challengeWithPopup() or an /mfa-challenge redirect), and gating the Transfer Funds ' +
        'action behind that verification?',
    ),
  ];
}
