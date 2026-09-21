import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('org_id', 'Checks the org_id claim on verified tokens', GraderLevel.L1),
    contains('org_barkbook_acme', 'Enforces the specific Acme org (org_barkbook_acme)', GraderLevel.L1),
    contains('verifyAccessToken', 'Uses verifyAccessToken to validate incoming tokens', GraderLevel.L1),
    contains('@auth0/auth0-api-js', 'Uses the @auth0/auth0-api-js SDK', GraderLevel.L1),
    contains('ApiClient', 'Creates an ApiClient instance', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK ─────────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2),
    notContains(
      'express-oauth2-jwt-bearer',
      'No express-oauth2-jwt-bearer (wrong SDK - task uses @auth0/auth0-api-js)',
      GraderLevel.L2,
    ),
    notContains('@auth0/auth0-react', 'No React SDK in an Express API', GraderLevel.L2),
    notContains(
      'express-openid-connect',
      'No express-openid-connect (that is the web-app OIDC SDK, not the API SDK)',
      GraderLevel.L2,
    ),
    notContains('jwks-rsa', 'No manual jwks-rsa (the SDK handles JWKS internally)', GraderLevel.L2),
    notContains(
      'jsonwebtoken',
      'No manual JWT verification with jsonwebtoken - verifyAccessToken must do the parsing',
      GraderLevel.L2,
    ),
    notContains(
      'jwt-decode',
      'No manual JWT decoding with jwt-decode - verifyAccessToken must do the parsing',
      GraderLevel.L2,
    ),

    // ── L3: Security ───────────────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in source files (ok in .env)', GraderLevel.L3),
    notContains('algorithm: "none"', 'No disabled JWT algorithm verification', GraderLevel.L3),

    // ── L4: Structural correctness ─────────────────────────────────────────
    compiles('Project compiles (tsc succeeds)', GraderLevel.L4),
    matches(
      String.raw`requiredClaims[\s\S]{0,80}org_id`,
      'Passes org_id in requiredClaims to enforce it is present on the token',
      GraderLevel.L4,
    ),
    judge(
      'Does the code compare the verified token org_id claim against the expected Acme organization ' +
        'and respond with a 403 (or equivalent rejection) when the claim is absent or does not match, ' +
        'going beyond merely requiring org_id via requiredClaims by checking the claim value, and ' +
        'treating an expected org id sourced from an environment variable such as AUTH0_ORG_ID as ' +
        'correctly wired while judging only from the source without assuming any .env file contents?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code include the org_id from the verified token in the API response body so clients ' +
        'can see which organization granted access?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    judge(
      'Does the code rely exclusively on apiClient.verifyAccessToken to parse and validate the JWT, ' +
        'and does it avoid manually decoding the token — no splitting the raw string on dots, no ' +
        'Buffer.from base64 decode, no importing jose directly, and no JWT library other than what ' +
        '@auth0/auth0-api-js exposes? The org_id claim must be read from the claims object returned by ' +
        'verifyAccessToken, not extracted by hand from the raw token string.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level - always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the Express API using ' +
        '@auth0/auth0-api-js - verifying access tokens with org_id in requiredClaims, rejecting tokens ' +
        'that do not carry the org_barkbook_acme org_id claim with an appropriate error response, ' +
        'and including the org_id in the API response? The domain and audience must be read from ' +
        'environment variables rather than hardcoded.',
    ),
  ];
}
