import { contains, notContains, notContainsInSource, judge, compiles, wroteFile, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('acr_values', 'Step-up request uses acr_values parameter', GraderLevel.L1),
    contains('amr', 'AMR claim checked to detect prior MFA completion', GraderLevel.L1),
    contains('idTokenClaims', 'Reads claims from req.oidc.idTokenClaims (server-side)', GraderLevel.L1),
    contains('oidc.login', 'Triggers step-up via res.oidc.login()', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('speakeasy', 'No server-side TOTP library (speakeasy) used', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib) used', GraderLevel.L2),
    notContains('@auth0/guardian', 'No fake Guardian client SDK referenced', GraderLevel.L2),
    notContains('mfa/challenge', 'Does not call raw MFA challenge endpoint directly', GraderLevel.L2),
    notContains(
      'loginWithRedirect',
      'Does not use SPA loginWithRedirect in a server-side Express app',
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
      'Does the code read the amr or acr claim from req.oidc.idTokenClaims (the server-side, ' +
        'cryptographically verified claims object) rather than from req.query, req.body, ' +
        'or any client-supplied value?',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    wroteFile('.env', 'Wrote Auth0 config to .env file', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'barkbook_client_abc123xyz',
    ]),
    compiles('Project passes syntax check (node --check)', GraderLevel.L4),
    judge(
      'Does the code check the amr claim on req.oidc.idTokenClaims to detect whether the ' +
        'current session reflects completed MFA (e.g. amr includes "mfa") before allowing ' +
        'the transfer to proceed?',
      GraderLevel.L4,
    ),
    judge(
      'When the amr claim is missing or does not include "mfa", does the code call ' +
        'res.oidc.login() with authorizationParams containing acr_values to redirect the ' +
        'user to Auth0 to complete MFA, rather than simply returning a 401 or proceeding?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code use afterCallback or an equivalent server-side check to verify that ' +
        'the returned session after the step-up redirect actually contains MFA evidence, ' +
        'rather than trusting only the pre-redirect session state?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    judge(
      'Does the code read MFA claims from req.oidc.idTokenClaims rather than req.oidc.user? ' +
        'req.oidc.user is subject to identityClaimFilter and may not include amr/acr; ' +
        'req.oidc.idTokenClaims always contains the full verified ID token payload.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up in an Express app using ' +
        'express-openid-connect — checking amr/acr claims from req.oidc.idTokenClaims, ' +
        'redirecting to Auth0 via res.oidc.login() with acr_values when MFA is absent, ' +
        'and gating the /transfer route behind that verification?',
    ),
  ];
}
