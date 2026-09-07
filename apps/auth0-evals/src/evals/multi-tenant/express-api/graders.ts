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
    // Accepts the inline form `mcd: { … }`, a hoisted `const mcd = { … }` passed
    // as ES6 shorthand, and `auth({ audience, mcd })`.
    matches(
      String.raw`mcd\s*(?::\s*\{|=\s*\{|[,}\)])`,
      'Passes the mcd (Multiple Custom Domains) option to auth()',
      GraderLevel.L1,
    ),
    // Requires `issuers` in key position — as `issuers:` or the ES6 shorthand
    // `{ issuers }` — so a bare mention inside a template literal or comment
    // does not satisfy it. The lookbehind matters: `matches` is case-insensitive
    // and unanchored, so a bare `issuers\s*:` also matches the invented option
    // `allowedIssuers:` that the L2 grader below exists to reject.
    matches(
      String.raw`(?<![A-Za-z])issuers\s*:|\{\s*issuers\s*\}|,\s*issuers\s*\}`,
      'Configures mcd.issuers',
      GraderLevel.L1,
    ),
    contains('TRUSTED_ISSUERS', 'Reads the issuer list from the TRUSTED_ISSUERS env var', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK ─────────────────────────────────
    notContains('issuerBaseURLs', 'No invented plural issuerBaseURLs option', GraderLevel.L2),
    notContains('allowedIssuers', 'No invented allowedIssuers option', GraderLevel.L2),
    notContains('multipleIssuers', 'No invented multipleIssuers option', GraderLevel.L2),
    // No `notContains('tenants')` here: a bare needle fails legitimate code —
    // `const tenants = …` and comments about onboarded tenants are both natural
    // in an eval living under multi-tenant/ — and the three needles above
    // already cover the invented-option hallucination.
    notContains('jsonwebtoken', 'No manual JWT verification with jsonwebtoken', GraderLevel.L2),
    notContains('jwks-rsa', 'No third-party jwks-rsa key resolution', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────
    notContainsInSource('auth.barkbook.com', 'No hardcoded brand issuer in source files (ok in .env)', GraderLevel.L3),
    notContainsInSource('auth.pawsome.com', 'No hardcoded brand issuer in source files (ok in .env)', GraderLevel.L3),
    notContainsInSource('auth.woofworld.com', 'No hardcoded brand issuer in source files (ok in .env)', GraderLevel.L3),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in source files (ok in .env)', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────
    // The three brand issuers belong in .env, not in source. ISSUER_BASE_URL must
    // NOT be set here — the SDK rejects `mcd` combined with it (see the L4 judge).
    wroteFile('.env', 'Wrote the trusted issuer list to .env', GraderLevel.L4, [
      'TRUSTED_ISSUERS',
      'auth.barkbook.com',
      'auth.pawsome.com',
      'auth.woofworld.com',
    ]),
    compiles('Project compiles (node --check succeeds)', GraderLevel.L4),
    contains('requiredScopes', 'Existing requiredScopes() scope checks retained', GraderLevel.L4),
    // Any split() form counts: split(','), split(/\s*,\s*/) — arguably better,
    // since it trims whitespace — and split(SEP) with a hoisted separator are all
    // legitimate. The holistic judge covers whether the parse is actually correct.
    matches(String.raw`\.split\s*\(`, 'Parses the comma-separated TRUSTED_ISSUERS value into a list', GraderLevel.L4),
    judge(
      'Does the solution remove the single-issuer configuration when switching to mcd? ' +
        'express-oauth2-jwt-bearer asserts that mcd is not combined with issuerBaseURL, issuer or jwksUri, and ' +
        'issuerBaseURL silently defaults to the ISSUER_BASE_URL environment variable. The scaffold ships a ' +
        '.env.example with ISSUER_BASE_URL populated, so a correct solution must both leave issuerBaseURL/' +
        'issuer/jwksUri out of the auth() call AND delete the ISSUER_BASE_URL line from .env — otherwise auth() ' +
        'throws at startup. Answer no if ISSUER_BASE_URL is still assigned a non-empty value in .env, or still ' +
        'passed to auth(). Note that merely blanking it (ISSUER_BASE_URL= with no value) does avoid the throw, ' +
        'because the SDK treats the empty string as unset — but the line should be removed.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────
    notContains(
      'req.user',
      'No req.user (express-oauth2-jwt-bearer exposes claims on req.auth.payload)',
      GraderLevel.L5,
    ),
    judge(
      'Does the solution configure multi-issuer validation through the SDK, by passing mcd: { issuers: [...] } ' +
        'to auth() with the issuer list (an array of issuer URL strings, or issuer config objects each having an ' +
        'issuer key, or a resolver function)? Answer no if it instead constructs several separate auth() ' +
        'middlewares and tries them in turn, or manually decodes the token to pick an issuer before verifying, ' +
        'or verifies signatures itself. Judge only from the source code; values may be supplied via environment ' +
        'variables, so do not assume the contents of any .env file.',
      GraderLevel.L5,
    ),

    // ── Holistic judge ────────────────────────────────────────────────
    judge(
      'Does the solution correctly extend the Express API to accept Auth0 access tokens from multiple custom ' +
        'domains using express-oauth2-jwt-bearer? It should pass mcd: { issuers: [...] } to auth() with the ' +
        'three brand issuers read from the comma-separated TRUSTED_ISSUERS environment variable and split into ' +
        'a list, must not also pass issuerBaseURL/issuer/jwksUri (which the SDK rejects when combined with ' +
        'mcd, including the ISSUER_BASE_URL environment variable default), must still validate the audience, ' +
        'and must keep the existing read:balance and write:transfers scope checks. ' +
        'Judge only from the source code and do not assume the contents of any .env file.',
    ),
  ];
}
