import { contains, notContains, notContainsInSource, judge, wroteFile, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required step-up symbols present ──────────────────────────────
    contains('express-oauth2-jwt-bearer', 'Uses express-oauth2-jwt-bearer SDK', GraderLevel.L1),
    contains('requiredScopes', 'Enforces the scope with the SDK requiredScopes middleware', GraderLevel.L1),
    contains('transfer:funds', 'Gates the transfer on the step-up scope transfer:funds', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ───────────────────────────────
    notContains('jsonwebtoken', 'No manual JWT decoding with jsonwebtoken', GraderLevel.L2),
    notContains('speakeasy', 'No server-side TOTP library (speakeasy)', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib)', GraderLevel.L2),
    notContains('@auth0/guardian', 'No fake Guardian server SDK', GraderLevel.L2),
    notContains('mfa/challenge', 'Does not call the raw MFA challenge endpoint', GraderLevel.L2),

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
    contains('read:balance', 'Existing read:balance scope check on GET /api/balance retained', GraderLevel.L4),
    // Grade the outcome (the transfer is gated on the step-up scope), not the exact call shape — a solution
    // may require the scope with a second requiredScopes call, a combined requiredScopes('write:transfers',
    // 'transfer:funds'), or a claimCheck on the scope claim.
    judge(
      'Does POST /api/transfers require the transfer:funds scope so a token that lacks it is rejected — ' +
        'while the existing write:transfers requirement is retained — using the SDK (requiredScopes, or a ' +
        'claimCheck/claimIncludes on the scope claim) rather than proceeding with the transfer?',
      GraderLevel.L4,
    ),
    judge(
      'Is the transfer:funds gate applied specifically to POST /api/transfers (not globally or to ' +
        'GET /api/balance), and does read:balance scope enforcement still apply to GET /api/balance?',
      GraderLevel.L4,
    ),
    judge(
      'Does the scope-checking middleware run AFTER checkJwt in the route middleware chain for ' +
        'POST /api/transfers? The scope claim is only available on req.auth.payload after checkJwt has ' +
        'validated the token — if the scope check is registered before checkJwt, req.auth is undefined and ' +
        'every request is rejected regardless of the scopes the caller actually holds.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ─────────────────────────────
    notContains(
      'req.user',
      'No req.user (express-oauth2-jwt-bearer exposes claims on req.auth.payload)',
      GraderLevel.L5,
    ),
    // requiredScopes / claimCheck raise the SDK's own 403 insufficient_scope — the pattern the SDK
    // examples teach. Manually parsing the space-delimited scope string or hand-decoding the JWT is the
    // deprecated path this check rules out.
    judge(
      'Does the solution enforce the scope through the SDK — requiredScopes, or claimCheck/claimIncludes ' +
        'reading the scope claim off req.auth.payload — rather than manually splitting the space-delimited ' +
        'scope string or hand-decoding the access token?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add step-up enforcement to the Express API using ' +
        'express-oauth2-jwt-bearer? POST /api/transfers must be gated on the transfer:funds scope — the ' +
        'scope the tenant issues only after MFA step-up — so a token without it is rejected with the SDK’s ' +
        '403 insufficient_scope, while the existing write:transfers check is retained. GET /api/balance must ' +
        'still require read:balance. Claims are read from req.auth.payload, and issuer/audience come from ' +
        'ISSUER_BASE_URL / AUDIENCE environment variables — judge only from source code.',
    ),
  ];
}
