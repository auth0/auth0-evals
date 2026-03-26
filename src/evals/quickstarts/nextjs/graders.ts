import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  GraderLevel,
} from '../../../agent_eval/graders.js';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('@auth0/nextjs-auth0', 'Uses @auth0/nextjs-auth0 SDK', GraderLevel.L1),
    contains('@auth0/nextjs-auth0/server', 'Uses v4 server import path', GraderLevel.L1),
    contains('Auth0Client', 'Instantiates Auth0Client', GraderLevel.L1),
    contains('AUTH0_CLIENT_ID', 'Configures AUTH0_CLIENT_ID', GraderLevel.L1),
    contains('AUTH0_CLIENT_SECRET', 'Configures AUTH0_CLIENT_SECRET', GraderLevel.L1),
    contains('AUTH0_SECRET', 'Configures AUTH0_SECRET', GraderLevel.L1),
    matches('AUTH0_DOMAIN', 'Configures AUTH0_DOMAIN', GraderLevel.L1),
    matches(String.raw`getSession`, 'Uses getSession for session retrieval', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('@auth0/nextjs-sdk', 'No hallucinated @auth0/nextjs-sdk package', GraderLevel.L2),
    notContains('@auth0/nextjs', 'No hallucinated @auth0/nextjs (must be @auth0/nextjs-auth0)', GraderLevel.L2),
    notContains('@auth0/auth0-react', 'Does not use SPA SDK in server app', GraderLevel.L2),

    // ── L3: Security checks ──────────────────────────────────────────────────
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
    judge(
      'Are all Auth0 credentials (domain, client ID, client secret, AUTH0_SECRET) ' +
        'stored in environment variables or .env files, not hardcoded in source code?',
      'nextjs',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    matches(
      String.raw`export\s+(default\s+)?function\s+middleware`,
      'Middleware function is exported from middleware file',
      GraderLevel.L4,
    ),
    matches(String.raw`auth0\.middleware`, 'Uses auth0.middleware in middleware file', GraderLevel.L4),
    matches(String.raw`dashboard/page\.(tsx|jsx|ts|js)`, 'Dashboard page file exists', GraderLevel.L4),
    contains('/auth/login', 'Uses /auth/login for login redirect', GraderLevel.L4),
    judge(
      'Does the code set up a working authentication flow with login, logout, and a callback route? ' +
        'Is there a protected /dashboard page that checks the user session and redirects unauthenticated users to log in?',
      'nextjs',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    notContains('AUTH0_BASE_URL', 'Does not use v3 env var AUTH0_BASE_URL (v4 uses APP_BASE_URL)', GraderLevel.L5),
    notContains(
      'AUTH0_ISSUER_BASE_URL',
      'Does not use v3 env var AUTH0_ISSUER_BASE_URL (removed in v4)',
      GraderLevel.L5,
    ),
    notContains('handleAuth', 'Does not use v3 handleAuth (v4 uses middleware)', GraderLevel.L5),
    notContains('/api/auth/', 'Does not use v3 route prefix /api/auth/ (v4 uses /auth/)', GraderLevel.L5),
    judge(
      'Does the solution correctly integrate Auth0 into a Next.js App Router app ' +
        'using Auth0Client from @auth0/nextjs-auth0/server, middleware-based auth ' +
        'routing, and getSession for server-side session access? It should NOT use ' +
        'the deprecated v3 patterns like handleAuth, withPageAuthRequired, or /api/auth/ routes. ' +
        'There should also be a protected /dashboard page that checks the session and ' +
        'redirects unauthenticated users to log in.',
      'nextjs',
      GraderLevel.L5,
    ),
    judge(
      'Does the code use current v4 environment variable names (AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET) ' +
        'and NOT deprecated v3 names (AUTH0_BASE_URL, AUTH0_ISSUER_BASE_URL)?',
      'nextjs',
      GraderLevel.L5,
    ),
  ];
}
