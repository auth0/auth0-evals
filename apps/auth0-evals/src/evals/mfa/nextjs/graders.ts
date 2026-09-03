import { contains, notContains, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('acr_values', 'Step-up request uses acr_values parameter', GraderLevel.L1),
    contains('amr', 'AMR claim checked to detect prior MFA completion', GraderLevel.L1),
    contains(
      'schemas.openid.net/pape/policies/2007/06/multi-factor',
      'Uses correct multi-factor acr_values policy URI',
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
      'Does not use React SPA getIdTokenClaims — reads amr via server session',
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
      'Does the code read the amr claim from the server-side session (e.g. session.user.amr) ' +
        'and check whether "mfa" is present in that array before allowing the transfer to proceed?',
      GraderLevel.L4,
    ),
    judge(
      'When the amr claim is missing or does not contain "mfa", does the code redirect the user ' +
        'to /auth/login with acr_values set to the multi-factor policy URI and max_age set to 0?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    notContains('handleAuth', 'Does not use v3 handleAuth (v4 uses middleware)', GraderLevel.L5),
    notContains('/api/auth/', 'Does not use v3 route prefix /api/auth/ (v4 uses /auth/)', GraderLevel.L5),
    notContains('AUTH0_ISSUER_BASE_URL', 'Does not use v3 env var AUTH0_ISSUER_BASE_URL', GraderLevel.L5),
    judge(
      'Does the Auth0Client instantiation use the beforeSessionSaved hook to copy the amr claim ' +
        'from the incoming session user object into the persisted session, so that amr is available ' +
        'on subsequent calls to auth0.getSession()?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up authentication in a Next.js App Router app ' +
        'using @auth0/nextjs-auth0 v4 — checking the amr claim to detect prior MFA completion, ' +
        'redirecting to /auth/login with acr_values and max_age=0 when MFA is absent, ' +
        'and gating the Transfer Funds action behind that verification?',
    ),
  ];
}
