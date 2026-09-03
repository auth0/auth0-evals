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
    // ── L1: Positive presence ──────────────────────────────────────────────────
    contains('express-oauth2-jwt-bearer', 'Uses express-oauth2-jwt-bearer SDK', GraderLevel.L1),
    contains('org_id', 'References the org_id claim from the JWT', GraderLevel.L1),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2),
    notContains(
      'requiresOrg(',
      'No invented requiresOrg() helper (does not exist in express-oauth2-jwt-bearer)',
      GraderLevel.L2,
    ),
    notContains('requiresOrganization(', 'No invented requiresOrganization() helper', GraderLevel.L2),
    // org_name is a real Auth0 claim (display name) but org_id is correct for programmatic enforcement.
    // Check for quoted form only to avoid false positives from prose/comments.
    notContains("'org_name'", "No 'org_name' as a claim argument — use org_id for org enforcement", GraderLevel.L2),
    notContains('"org_name"', 'No "org_name" as a claim argument — use org_id for org enforcement', GraderLevel.L2),
    notContains('express-openid-connect', 'No express-openid-connect (web app SDK, not for APIs)', GraderLevel.L2),
    notContains('jsonwebtoken', 'No manual JWT decoding with jsonwebtoken (use SDK middleware)', GraderLevel.L2),

    // ── L3: Security checks ────────────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in source files (ok in .env)', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    wroteFile('.env', 'Wrote Auth0 config to .env file', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'api.barkbook.com',
    ]),
    compiles('Project compiles (node --check succeeds)', GraderLevel.L4),
    matches(
      String.raw`(claimEquals\s*\(\s*['"\`]org_id['"\`][\s\S]{0,100}org_barkbook_acme|claimCheck[\s\S]{0,200}org_barkbook_acme)`,
      'Uses claimEquals("org_id", "org_barkbook_acme") or claimCheck with org_barkbook_acme to enforce org membership',
      GraderLevel.L4,
    ),
    judge(
      'Does GET /api/org/members correctly restrict access to users in org_barkbook_acme? ' +
        'The route must apply both the auth() JWT validation middleware and a claimEquals (or claimCheck) ' +
        'middleware that enforces org_id === "org_barkbook_acme". A missing or wrong org_id should yield a 4xx error.',
      GraderLevel.L4,
    ),
    judge(
      'Does GET /api/org/profile return the org_id from the verified token (e.g. req.auth.payload.org_id)? ' +
        'The route must be protected by auth() and read org_id from the decoded token payload, not hardcode it.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    notContains(
      'req.user',
      'No req.user — express-oauth2-jwt-bearer exposes claims on req.auth.payload',
      GraderLevel.L5,
    ),
    notContains(
      'req.auth.payload.org_id ===',
      'No manual org_id equality check — use claimEquals() or claimCheck() SDK helpers',
      GraderLevel.L5,
    ),
    notContains(
      'req.auth.payload.org_id !==',
      'No manual org_id inequality check — use claimEquals() or claimCheck() SDK helpers',
      GraderLevel.L5,
    ),
    judge(
      'Does the solution use current express-oauth2-jwt-bearer patterns? ' +
        'Specifically: does it apply auth() for JWT validation, use claimEquals() or claimCheck() for ' +
        'org_id enforcement (not a manual req.auth.payload.org_id comparison inside the handler), ' +
        'and access token data via req.auth.payload? ' +
        'Judge only from the source code; the issuer and audience may be supplied via environment variables ' +
        '(ISSUER_BASE_URL / AUDIENCE), so do not assume the contents of any .env file.',
      GraderLevel.L5,
    ),

    // ── Holistic judge ────────────────────────────────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the Express API using ' +
        'express-oauth2-jwt-bearer? ' +
        'GET /api/org/members must be protected by auth() and restricted to users whose org_id claim equals ' +
        '"org_barkbook_acme" using the SDK middleware (claimEquals or claimCheck) — a missing or mismatched ' +
        'org_id must yield a 4xx response. ' +
        "GET /api/org/profile must return the caller's org_id read from req.auth.payload. " +
        'The issuer and audience may come from ISSUER_BASE_URL / AUDIENCE environment variables — ' +
        'judge only from the source code and do not assume the contents of any .env file.',
    ),
  ];
}
