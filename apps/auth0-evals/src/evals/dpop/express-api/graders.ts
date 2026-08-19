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
    matches(String.raw`dpop\s*:\s*\{`, 'Passes a dpop option block to auth()', GraderLevel.L1),
    matches(String.raw`required\s*:\s*true`, 'Sets dpop.required to reject Bearer tokens', GraderLevel.L1),
    matches(String.raw`iatOffset\s*:\s*120`, 'Sets iatOffset to 120 (2-minute proof window)', GraderLevel.L1),
    matches(String.raw`iatLeeway\s*:\s*15`, 'Sets iatLeeway to 15 (clock skew tolerance)', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK ─────────────────────────────────
    notContains('express-dpop', 'No invented express-dpop package', GraderLevel.L2),
    notContains('dpop-express', 'No invented dpop-express package', GraderLevel.L2),
    notContains('jose', 'No jose dependency — the SDK validates DPoP proofs internally', GraderLevel.L2),
    notContains('crypto.subtle', 'No hand-rolled DPoP proof cryptography', GraderLevel.L2),
    notContains('jwt.verify', 'No manual JWT verification (SDK handles verification)', GraderLevel.L2),

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
      String.raw`trust\s+proxy`,
      'Enables Express proxy trust so req.host/req.protocol yield the external URL for the DPoP htu claim',
      GraderLevel.L4,
    ),
    contains('requiredScopes', 'Existing requiredScopes() scope checks retained', GraderLevel.L4),
    judge(
      'Is DPoP configured so that plain Bearer tokens are rejected? ' +
        'The correct configuration passes a dpop object to auth() with BOTH enabled: true (or omitted, since it ' +
        'defaults to true) AND required: true. Note that dpop: { enabled: false, required: true } is a ' +
        'misconfiguration that does NOT enforce DPoP — DPoP would be ignored entirely and Bearer tokens accepted.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────
    notContains(
      'requireDpop',
      'No invented flat requireDpop option (DPoP settings are nested under dpop)',
      GraderLevel.L5,
    ),
    notContains(
      'dpopRequired',
      'No invented flat dpopRequired option (DPoP settings are nested under dpop)',
      GraderLevel.L5,
    ),
    notContains('useDpop', 'No useDpop option — that is the browser-side @auth0/auth0-spa-js API', GraderLevel.L5),
    judge(
      'Does the solution use current express-oauth2-jwt-bearer DPoP support? ' +
        'Specifically: are the DPoP settings nested inside a single dpop option object passed to auth() ' +
        '(with required, iatOffset and iatLeeway as keys of that object), rather than flat top-level options ' +
        'on auth() or invented helper middleware? The proof timing values must be numbers in seconds. ' +
        'Judge only from the source code; the issuer and audience may be supplied via environment ' +
        'variables (ISSUER_BASE_URL / AUDIENCE), so do not assume the contents of any .env file.',
      GraderLevel.L5,
    ),

    // ── Holistic judge ────────────────────────────────────────────────
    judge(
      'Does the solution correctly enforce DPoP-only authentication on the Express API using ' +
        'express-oauth2-jwt-bearer? It should pass a dpop option object to auth() that both enables DPoP and ' +
        'sets required: true so plain Bearer tokens are rejected, set iatOffset to 120 seconds and iatLeeway to ' +
        '15 seconds, enable Express proxy trust so the DPoP htu claim is validated against the external URL, ' +
        'and keep the existing read:balance and write:transfers scope checks. The issuer and audience may come ' +
        'from ISSUER_BASE_URL / AUDIENCE environment variables — judge only from the source code and do not ' +
        'assume the contents of any .env file.',
    ),
  ];
}
