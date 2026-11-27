import { matches, notContains, notContainsInSource, judge, wroteFile, compiles, GraderLevel } from '@a0/evals-graders';

// ── Route-bound scope patterns ────────────────────────────────────────────────
// Each pattern ties a scope to the route it guards, so a scope on the wrong route, in a global
// app.use, after the handler, or only in a comment (ignoreComments) does not count.

/** Any JS string quote. */
const Q = String.raw`['"\`]`;
/** One character inside a single-line string literal. */
const STR_CHAR = String.raw`[^'"\`\n]`;
/** Ends a route's middleware list: the handler (arrow/function), a statement end, or the next route call. */
const STOP = String.raw`=>|\bfunction\b|;|\.(?:get|post|put|patch|delete|all|use|route)\s*\(`;
/** Middleware arguments of one route call, up to its handler. */
const ROUTE_ARGS = String.raw`(?:(?!${STOP})[\s\S]){0,400}?`;
/** The value of one `const x = …` declaration (stops at the next declaration or route). */
const DECL_VALUE = String.raw`(?:(?!${STOP}|\b(?:const|let|var)\b)[\s\S]){0,200}?`;

/** A quoted string holding `scope` as one space-delimited token, e.g. 'write:transfers transfer:funds'. */
const scopeString = (scope: string) => String.raw`${Q}(?:${STR_CHAR}*\s)?${scope}(?:\s${STR_CHAR}*)?${Q}`;

/**
 * requiredScopes(...) whose first argument requires `scope`, as a string or an array element.
 * requiredScopes reads only its first argument, so requiredScopes('write:transfers', 'transfer:funds')
 * never enforces transfer:funds and does not match it.
 */
const requiredScopesCall = (scope: string) =>
  String.raw`\brequiredScopes\s*\(\s*(?:${scopeString(scope)}|\[[^\]]*?${Q}${scope}${Q}[^\]]*\])\s*[,)]`;

/** `app.post('/path', …` or `app.route('/path').post(…`. */
const routeHead = (method: string, path: string) =>
  String.raw`(?:\.${method}\s*\(\s*${Q}${path}${Q}\s*,|\.route\s*\(\s*${Q}${path}${Q}\s*\)\s*\.${method}\s*\()`;

/**
 * `scope` guards `method path`: a requiredScopes call sits in the route's middleware arguments, or a
 * variable holding one (const requireStepUp = requiredScopes('transfer:funds'), or an array of
 * middleware) is passed there.
 */
const scopeOnRoute = (method: string, path: string, scope: string) =>
  String.raw`(?:${routeHead(method, path)}${ROUTE_ARGS}${requiredScopesCall(scope)})` +
  String.raw`|(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=${DECL_VALUE}${requiredScopesCall(scope)}` +
  String.raw`[\s\S]*?${routeHead(method, path)}${ROUTE_ARGS}(?<![\w$.])\1(?![\w$]))`;

const CODE = { caseSensitive: true, ignoreComments: true } as const;

export function defineGraders() {
  return [
    // ── L1: Required step-up symbols present ──────────────────────────────
    matches(
      requiredScopesCall('transfer:funds'),
      'Requires the step-up scope transfer:funds with requiredScopes',
      GraderLevel.L1,
      CODE,
    ),

    // ── L2: Hallucination / wrong approach ───────────────────────────────
    notContains('jsonwebtoken', 'No manual JWT decoding with jsonwebtoken', GraderLevel.L2, { ignoreComments: true }),
    notContains('speakeasy', 'No server-side TOTP library (speakeasy)', GraderLevel.L2, { ignoreComments: true }),
    notContains('otplib', 'No server-side TOTP library (otplib)', GraderLevel.L2, { ignoreComments: true }),
    notContains('@auth0/guardian', 'No fake Guardian server SDK', GraderLevel.L2, { ignoreComments: true }),
    notContains('mfa/challenge', 'Does not call the raw MFA challenge endpoint', GraderLevel.L2, {
      ignoreComments: true,
    }),

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
    matches(
      scopeOnRoute('post', '/api/transfers', 'transfer:funds'),
      'POST /api/transfers requires the step-up scope transfer:funds',
      GraderLevel.L4,
      CODE,
    ),
    matches(
      scopeOnRoute('post', '/api/transfers', 'write:transfers'),
      'POST /api/transfers requires write:transfers',
      GraderLevel.L4,
      CODE,
    ),
    matches(
      scopeOnRoute('get', '/api/balance', 'read:balance'),
      'GET /api/balance requires read:balance',
      GraderLevel.L4,
      CODE,
    ),
    judge(
      'Does POST /api/transfers reject a token that lacks transfer:funds and also reject a token that lacks ' +
        'write:transfers, with both scopes enforced through the express-oauth2-jwt-bearer requiredScopes ' +
        'middleware? Answer no if transfer:funds is passed to requiredScopes as a second argument: ' +
        'requiredScopes reads only its first argument, so that scope is never checked.',
      GraderLevel.L4,
    ),
    judge(
      'Is the transfer:funds requirement applied only to POST /api/transfers, so that GET /api/balance ' +
        'requires read:balance but not transfer:funds, and no app-wide middleware demands transfer:funds?',
      GraderLevel.L4,
    ),
    judge(
      'Does every scope check run after checkJwt in its route middleware chain? The scope claim is only on ' +
        'req.auth.payload once checkJwt has validated the token, so a scope check registered before checkJwt ' +
        'rejects every request whatever scopes the caller holds.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ─────────────────────────────
    notContains(
      'req.user',
      'No req.user (express-oauth2-jwt-bearer exposes claims on req.auth.payload)',
      GraderLevel.L5,
      { ignoreComments: true },
    ),
    judge(
      'Does the solution enforce scopes with requiredScopes from express-oauth2-jwt-bearer, rather than ' +
        'splitting the space-delimited scope string by hand, decoding the access token itself, or reading ' +
        'claims from req.user?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution enforce MFA step-up on the Express API with express-oauth2-jwt-bearer? The tenant ' +
        'adds transfer:funds to the access token only after the customer completes MFA, so POST /api/transfers ' +
        'must require both transfer:funds and write:transfers, and GET /api/balance must require read:balance ' +
        'but not transfer:funds. Each scope check must run after checkJwt, and the issuer and audience must ' +
        'come from the ISSUER_BASE_URL and AUDIENCE environment variables. Judge only from source code.',
    ),
  ];
}
