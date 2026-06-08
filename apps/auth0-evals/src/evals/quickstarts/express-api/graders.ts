import { contains, notContains, notContainsInSource, matches, judge, wroteFile, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence ──────────────────────────────────────────────────
    contains('express-oauth2-jwt-bearer', 'Uses express-oauth2-jwt-bearer SDK', GraderLevel.L1),
    contains('issuerBaseURL', 'Configures issuerBaseURL', GraderLevel.L1),
    contains('audience', 'Configures audience claim', GraderLevel.L1),
    contains('requiredScopes', 'Uses requiredScopes() for scope-based route protection', GraderLevel.L1),
    contains('req.auth', 'Accesses JWT data via req.auth', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('express-openid-connect', 'No express-openid-connect (that is for web apps, not APIs)', GraderLevel.L2),
    notContains('passport', 'No passport middleware (not needed with express-oauth2-jwt-bearer)', GraderLevel.L2),
    notContains('jsonwebtoken', 'No manual JWT verification with jsonwebtoken (use SDK)', GraderLevel.L2),
    notContains('@auth0/auth0-spa-js', 'No SPA SDK used in server-side API', GraderLevel.L2),

    // ── L3: Security checks ────────────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in source files (ok in .env)', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    // Event-based install verification temporarily disabled — see PR scoping discussion.
    // ranCommand(
    //   'npm install',
    //   'express-oauth2-jwt-bearer',
    //   'Ran npm install for express-oauth2-jwt-bearer',
    //   GraderLevel.L4,
    // ),
    wroteFile('.env', 'Wrote Auth0 config to .env file', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'api.barkbook.com',
    ]),

    matches(
      String.raw`requiredScopes\s*\(\s*.*read:messages`,
      'GET /api/messages protected with read:messages scope',
      GraderLevel.L4,
    ),
    matches(
      String.raw`requiredScopes\s*\(\s*.*write:messages`,
      'POST /api/messages protected with write:messages scope',
      GraderLevel.L4,
    ),
    judge(
      'Does the API correctly protect all three routes? ' +
        'GET /api/messages requires read:messages, POST /api/messages requires write:messages, ' +
        'GET /api/profile returns user info from req.auth.payload. ' +
        'Missing or invalid tokens should yield 401, insufficient scope should yield 403.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    notContains(
      'req.headers.authorization',
      'No manual Authorization header parsing (SDK handles extraction)',
      GraderLevel.L5,
    ),
    notContains('jwt.verify', 'No manual jwt.verify calls (SDK handles verification)', GraderLevel.L5),
    notContains('req.user', 'No req.user (express-oauth2-jwt-bearer uses req.auth, not req.user)', GraderLevel.L5),
    judge(
      'Does the solution use current express-oauth2-jwt-bearer patterns? ' +
        'Specifically: does it configure auth() with issuerBaseURL and audience, ' +
        'use requiredScopes() for scope checks (not manual payload inspection), ' +
        'and access token data via req.auth.payload (not req.user or manually decoded tokens)?',
      GraderLevel.L5,
    ),

    // ── Holistic judge ────────────────────────────────────────────────────────
    judge(
      'Does the solution correctly protect an Express.js API using express-oauth2-jwt-bearer? ' +
        'It should configure auth() middleware with issuerBaseURL and audience, ' +
        'protect GET /api/messages with read:messages scope, ' +
        'protect POST /api/messages with write:messages scope, ' +
        'and return user profile info from req.auth.payload at GET /api/profile.',
    ),
  ];
}
