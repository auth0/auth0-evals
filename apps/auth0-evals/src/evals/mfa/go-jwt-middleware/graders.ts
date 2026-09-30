import { contains, notContains, notContainsInSource, judge, wroteFile, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required step-up symbols present ──────────────────────────────
    contains('github.com/auth0/go-jwt-middleware/v2', 'Uses go-jwt-middleware v2', GraderLevel.L1),
    contains('transfer:funds', 'Gates the transfer on the step-up scope transfer:funds', GraderLevel.L1),
    contains('HasScope', 'Checks the scope through the CustomClaims HasScope helper', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ───────────────────────────────
    notContains('golang-jwt/jwt', 'No manual JWT parsing with golang-jwt', GraderLevel.L2),
    notContains('dgrijalva/jwt-go', 'No manual JWT parsing with the abandoned dgrijalva/jwt-go', GraderLevel.L2),
    // The v2 module path is .../go-jwt-middleware/v2 — the bare path ending in the
    // quote is the deprecated v1 import.
    notContains('go-jwt-middleware"', 'No deprecated v1 go-jwt-middleware import', GraderLevel.L2),

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
    contains('write:transfers', 'Existing write:transfers scope check retained', GraderLevel.L4),
    contains('read:balance', 'Existing read:balance scope check on GET /api/balance retained', GraderLevel.L4),
    // Grade the outcome (the transfer is gated on the step-up scope), not the exact call shape — a solution
    // may add a second scope check, combine both scopes in one HasScope-style guard, or chain the existing
    // requireScope helper twice.
    judge(
      'Does POST /api/transfers require the transfer:funds scope so a token that lacks it is rejected with ' +
        '403 insufficient_scope — while the existing write:transfers requirement is retained — reading the ' +
        'scope off the validated CustomClaims rather than proceeding with the transfer?',
      GraderLevel.L4,
    ),
    judge(
      'Is the transfer:funds gate applied specifically to POST /api/transfers (not globally or to ' +
        'GET /api/balance), and does read:balance scope enforcement still apply to GET /api/balance?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ─────────────────────────────
    // The v2 SDK exposes validated claims on the request context under
    // jwtmiddleware.ContextKey{} as *validator.ValidatedClaims. Hand-decoding the
    // bearer token or reading a bespoke context key is the deprecated path.
    judge(
      'Does the solution read the scope from the SDK-validated claims — the *validator.ValidatedClaims ' +
        'pulled off the request context under jwtmiddleware.ContextKey{}, cast to the CustomClaims type — ' +
        'rather than re-parsing the Authorization header or hand-decoding the JWT payload?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add step-up enforcement to the Go API using go-jwt-middleware v2? ' +
        'POST /api/transfers must be gated on the transfer:funds scope — the scope the tenant issues only ' +
        'after MFA step-up — so a token without it is rejected with 403 insufficient_scope, while the ' +
        'existing write:transfers check is retained. GET /api/balance must still require read:balance. The ' +
        'scope is read from the SDK-validated CustomClaims, and the issuer domain and audience come from the ' +
        'AUTH0_DOMAIN / AUTH0_AUDIENCE environment variables — judge only from source code.',
    ),
  ];
}
