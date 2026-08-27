import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  wroteFile,
  compiles,
  GraderLevel,
} from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ──────────────────────────
    contains('express-oauth2-jwt-bearer', 'Uses express-oauth2-jwt-bearer SDK', GraderLevel.L1),
    contains('amr', 'AMR claim referenced to detect MFA completion', GraderLevel.L1),
    contains('mfa_required', 'Returns mfa_required error code on step-up failure', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ───────────────────────────────
    notContains('jsonwebtoken', 'No manual JWT decoding with jsonwebtoken', GraderLevel.L2),
    notContains('speakeasy', 'No server-side TOTP library (speakeasy)', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib)', GraderLevel.L2),
    notContains('@auth0/guardian', 'No fake Guardian server SDK', GraderLevel.L2),
    notContains('mfa/challenge', 'Does not call the raw MFA challenge endpoint', GraderLevel.L2),
    // The amr check must be on payload — req.auth.amr is the express-jwt (not
    // express-oauth2-jwt-bearer) path; the correct path is req.auth.payload.amr.
    notContains(
      'req.auth.amr',
      'Does not read amr from req.auth.amr (express-jwt path) — correct path is req.auth.payload.amr',
      GraderLevel.L2,
    ),

    // ── L3: Security checks ──────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in source files (ok in .env)', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ──────────────────────────
    wroteFile('.env', 'Wrote Auth0 config to .env file', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'api.barkbook.com',
    ]),
    compiles('Project compiles (node --check succeeds)', GraderLevel.L4),
    contains('requiredScopes', 'Existing requiredScopes() scope checks retained', GraderLevel.L4),
    // The MFA check must respond with HTTP 403, not 401. claimIncludes returns 401
    // (invalid_token), so the correct approach is custom middleware with res.status(403).
    matches(String.raw`res\.status\s*\(\s*403\s*\)`, 'MFA step-up failure responds with HTTP 403', GraderLevel.L4),
    judge(
      'Does the code read the amr claim from req.auth.payload.amr (not req.auth.amr, which is the ' +
        'express-jwt path), check whether it includes "mfa", and return a 403 with code: "mfa_required" ' +
        'when MFA has not been completed?',
      GraderLevel.L4,
    ),
    judge(
      'Is the MFA check applied specifically to POST /api/transfers (not globally or only to ' +
        'GET /api/balance), and does write:transfers scope enforcement still apply to that route?',
      GraderLevel.L4,
    ),
    judge(
      'Does the MFA middleware run AFTER checkJwt in the route middleware chain for POST /api/transfers? ' +
        'The amr claim is only available on req.auth.payload after checkJwt has validated the token — ' +
        'if the MFA check is registered before checkJwt, req.auth is undefined and every request is ' +
        'rejected with a 403 regardless of whether the caller completed MFA.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ─────────────────────────────
    notContains(
      'req.user',
      'No req.user (express-oauth2-jwt-bearer exposes claims on req.auth.payload)',
      GraderLevel.L5,
    ),
    // Using claimIncludes for the amr check is wrong here because it returns 401
    // invalid_token instead of the required 403 mfa_required. Flag it.
    judge(
      'Does the solution use custom middleware (rather than claimIncludes) for the MFA check, so ' +
        'that the response is a 403 with code: "mfa_required" rather than a 401 invalid_token? ' +
        'claimIncludes("amr", "mfa") would silently return 401 — the correct pattern reads ' +
        'req.auth.payload.amr in its own middleware and responds with 403.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add MFA step-up enforcement to the Express API using ' +
        'express-oauth2-jwt-bearer? POST /api/transfers must be gated behind both the write:transfers ' +
        'scope check and an amr check that returns 403 with code: "mfa_required" when the token does ' +
        'not include "mfa" in the amr claim. GET /api/balance must still require read:balance. ' +
        'The amr claim must be read from req.auth.payload.amr. The issuer and audience may come from ' +
        'ISSUER_BASE_URL / AUDIENCE environment variables — judge only from source code.',
    ),
  ];
}
