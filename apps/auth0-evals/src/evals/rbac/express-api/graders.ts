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
    // ── L1: Positive presence ──────────────────────────────────────────
    contains('express-oauth2-jwt-bearer', 'Uses express-oauth2-jwt-bearer SDK', GraderLevel.L1),
    contains('scopeIncludesAny', 'Uses scopeIncludesAny() for the either/or scope check', GraderLevel.L1),
    contains('claimIncludes', 'Uses claimIncludes() for the RBAC permissions check', GraderLevel.L1),
    contains('claimEquals', 'Uses claimEquals() for the exact isAdmin claim check', GraderLevel.L1),
    contains('permissions', 'References the RBAC permissions claim', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK ─────────────────────────────────
    notContains('requiredPermissions', 'No invented requiredPermissions() helper', GraderLevel.L2),
    notContains('requiredScope(', 'No invented singular requiredScope() helper', GraderLevel.L2),
    notContains('scopeIncludesAll', 'No invented scopeIncludesAll() helper', GraderLevel.L2),
    notContains('claimMatches', 'No invented claimMatches() helper', GraderLevel.L2),
    notContains('express-jwt-permissions', 'No third-party express-jwt-permissions package', GraderLevel.L2),
    notContains('jsonwebtoken', 'No manual JWT decoding with jsonwebtoken', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in source files (ok in .env)', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────
    wroteFile('.env', 'Wrote Auth0 config to .env file', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'api.barkbook.com',
    ]),
    compiles('Project compiles (node --check succeeds)', GraderLevel.L4),
    matches(
      String.raw`claimIncludes\s*\(\s*['"\`]permissions['"\`]\s*,\s*['"\`]delete:accounts['"\`]`,
      'DELETE /api/accounts/:id gated on the delete:accounts RBAC permission via claimIncludes',
      GraderLevel.L4,
    ),
    matches(
      String.raw`claimEquals\s*\(\s*['"\`]isAdmin['"\`]\s*,\s*true\s*\)`,
      'GET /api/admin gated on claimEquals with boolean true (not the string "true")',
      GraderLevel.L4,
    ),
    matches(
      String.raw`scopeIncludesAny\s*\(\s*(['"\`][^'"\`]*read:(reports|audit)|\[)`,
      'GET /api/reports uses scopeIncludesAny for the read:reports / read:audit either-or check',
      GraderLevel.L4,
    ),
    // `requiredScopes` takes ONE argument (string | string[]). The multi-argument
    // form `requiredScopes('a', 'b')` silently drops everything after the first,
    // so it type-checks and runs but under-enforces. Match only the forms that
    // pass both scopes together: a single quoted string, or an array literal.
    matches(
      String.raw`requiredScopes\s*\(\s*(?:\[(?=[^\]]*write:transfers)(?=[^\]]*approve:transfers)|['"\`](?=[^'"\`]*write:transfers)(?=[^'"\`]*approve:transfers))`,
      'POST /api/transfers/bulk passes both scopes in one requiredScopes argument (string or array), not as two arguments',
      GraderLevel.L4,
    ),
    judge(
      'Does POST /api/transfers/bulk require BOTH the write:transfers AND approve:transfers scopes? ' +
        'The correct call passes both scopes in ONE argument to requiredScopes — either as a single ' +
        'space-separated string, e.g. requiredScopes("write:transfers approve:transfers"), or as an array, ' +
        'e.g. requiredScopes(["write:transfers", "approve:transfers"]). ' +
        'Answer no if the two scopes are passed as two separate arguments, e.g. ' +
        'requiredScopes("write:transfers", "approve:transfers"), because that form silently ignores every ' +
        'argument after the first and would let a caller through with only write:transfers.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────
    notContains(
      'req.user',
      'No req.user (express-oauth2-jwt-bearer exposes claims on req.auth.payload)',
      GraderLevel.L5,
    ),
    notContains(
      'req.auth.payload.scope.split',
      'No hand-rolled scope string splitting — the SDK helpers do this',
      GraderLevel.L5,
    ),
    judge(
      'Does the solution delegate every authorization check to the express-oauth2-jwt-bearer middleware ' +
        'helpers (requiredScopes, scopeIncludesAny, claimIncludes, claimEquals or claimCheck) applied as route ' +
        'middleware, rather than hand-rolling checks inside route handlers by reading req.auth.payload.scope or ' +
        'req.auth.payload.permissions and comparing manually? ' +
        'Also confirm the RBAC permission check reads the permissions claim rather than the scope claim, ' +
        'since Auth0 RBAC populates permissions and not scope.',
      GraderLevel.L5,
    ),

    // ── Holistic judge ────────────────────────────────────────────────
    judge(
      'Does the solution correctly add fine-grained authorization to the Express API using ' +
        'express-oauth2-jwt-bearer? POST /api/transfers/bulk must require both write:transfers and ' +
        'approve:transfers passed as a single space-separated string or array to requiredScopes; ' +
        'GET /api/reports must accept either read:reports or read:audit via scopeIncludesAny; ' +
        'DELETE /api/accounts/:id must check the delete:accounts RBAC permission via ' +
        "claimIncludes('permissions', 'delete:accounts'); GET /api/admin must use claimEquals('isAdmin', true) " +
        'with a boolean. The existing /api/balance and /api/transfers routes must still be protected. ' +
        'The issuer and audience may come from ISSUER_BASE_URL / AUDIENCE environment variables — judge only ' +
        'from the source code and do not assume the contents of any .env file.',
    ),
  ];
}
