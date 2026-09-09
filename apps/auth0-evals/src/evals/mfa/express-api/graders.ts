import { contains, notContains, notContainsInSource, judge, wroteFile, compiles, GraderLevel } from '@a0/evals-graders';

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
    // Grade the outcome (a 403 on the gated route), not the exact call shape — a solution may
    // send the 403 through res.status(403), next(err) into an error handler, or a helper.
    judge(
      'When a token whose amr does not include "mfa" calls POST /api/transfers, does the API respond ' +
        'with HTTP 403 and code: "mfa_required" — regardless of whether that response is produced by ' +
        'res.status(403), next(err) into an error handler, or a helper?',
      GraderLevel.L4,
    ),
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
    // The required outcome is a 403 mfa_required; claimIncludes("amr","mfa") returns 401
    // invalid_token, so it fails the outcome — but any path that yields the 403 is acceptable.
    judge(
      'Does the MFA check ultimately return a 403 with code: "mfa_required" (not a 401 invalid_token) ' +
        'when amr lacks "mfa"? Any implementation that yields that 403 is acceptable — custom ' +
        'middleware reading req.auth.payload.amr is the natural fit, but the grade is on the 403 ' +
        'mfa_required outcome, not on avoiding a specific API.',
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
