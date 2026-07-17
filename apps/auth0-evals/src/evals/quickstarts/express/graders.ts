import { contains, notContains, notContainsInSource, matches, judge, wroteFile, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('express-openid-connect', 'Uses express-openid-connect SDK', GraderLevel.L1),
    contains('issuerBaseURL', 'Configures issuerBaseURL', GraderLevel.L1),
    contains('clientID', 'Configures clientID', GraderLevel.L1),
    contains('baseURL', 'Configures baseURL', GraderLevel.L1),
    contains('secret', 'Configures session secret', GraderLevel.L1),
    contains('req.oidc', 'Uses req.oidc to access OIDC context', GraderLevel.L1),
    contains('req.oidc.user', 'Accesses user profile via req.oidc.user', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains(
      '@auth0/auth0-spa-js',
      'No hallucinated @auth0/auth0-spa-js (wrong SDK for server-side app)',
      GraderLevel.L2,
    ),
    notContains(
      'express-oauth2-jwt-bearer',
      'No express-oauth2-jwt-bearer (that is for APIs, not web apps)',
      GraderLevel.L2,
    ),
    notContains('@auth0/nextjs-auth0', 'Does not use Next.js SDK in Express app', GraderLevel.L2),
    notContains('passport', 'No passport middleware (not needed with express-openid-connect)', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded Auth0 domain in source files (ok in .env)',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    // Event-based install verification temporarily disabled — see PR scoping discussion.
    // ranCommand('npm install', 'express-openid-connect', 'Ran npm install for express-openid-connect', GraderLevel.L4),
    wroteFile('.env', 'Wrote Auth0 credentials to .env file', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'barkbook_client_abc123xyz',
      'barkbook_secret_def456uvw',
    ]),
    matches(String.raw`app\.use\s*\(\s*auth\s*\(`, 'auth middleware registered with app.use', GraderLevel.L4),
    contains('requiresAuth', 'Uses requiresAuth() to protect the /profile route', GraderLevel.L4),
    contains('req.oidc.accessToken', 'Accesses access token via req.oidc.accessToken', GraderLevel.L4),
    judge(
      'Does the app correctly register the auth() middleware, protect the /profile route with requiresAuth(), ' +
        'display user profile information, and include a route that calls an external API using the access token?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    contains('authorizationParams', 'Uses authorizationParams to pass audience and scope', GraderLevel.L5),
    matches(
      String.raw`audience.*api\.barkbook\.com`,
      "authorizationParams contains audience 'https://api.barkbook.com'",
      GraderLevel.L5,
    ),
    judge(
      'Does the solution use current express-openid-connect patterns? ' +
        'Specifically: does it use issuerBaseURL (not AUTH0_DOMAIN or domain directly), ' +
        'configure audience via authorizationParams (not as a top-level config key), ' +
        'and use response_type: "code" for the authorization code flow?',
      GraderLevel.L5,
    ),

    // ── Holistic judge ────────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into an Express web app using express-openid-connect? ' +
        'It should configure the auth() middleware, protect the /profile route with requiresAuth(), ' +
        'display the logged-in user profile, and use the access token to call an external API ' +
        'with audience https://api.barkbook.com.',
    ),
  ];
}
