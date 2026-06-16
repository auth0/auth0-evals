import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  wroteFile,
  compiles,
  GraderLevel,
} from '@a0/eval-graders';

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
    notContains('next-auth', 'No hallucinated next-auth package', GraderLevel.L2),
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
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded Auth0 domain in source files (ok in .env)',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    // Install verification left disabled — a valid solution may edit package.json then run a bare `npm install`.
    // ranCommand('npm install', '@auth0/nextjs-auth0', 'Ran npm install for @auth0/nextjs-auth0', GraderLevel.L4),
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    wroteFile('.env', 'Wrote Auth0 credentials to .env file', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'barkbook_client_abc123xyz',
      'barkbook_secret_def456uvw',
    ]),
    matches(
      String.raw`export\s+(default\s+)?(async\s+)?function\s+(middleware|proxy)`,
      'Middleware function is exported from middleware or proxy file',
      GraderLevel.L4,
    ),
    matches(String.raw`auth0\.middleware`, 'Uses auth0.middleware in middleware file', GraderLevel.L4),
    matches(String.raw`dashboard/page\.(tsx|jsx|ts|js)`, 'Dashboard page file exists', GraderLevel.L4),
    contains('/auth/login', 'Uses /auth/login for login redirect', GraderLevel.L4),
    contains('getAccessToken', 'Uses auth0.getAccessToken() for server-side token retrieval', GraderLevel.L4),
    contains(
      'https://api.playground.com',
      'Requests an access token with audience https://api.playground.com',
      GraderLevel.L4,
    ),
    judge(
      'Does the code set up a working authentication flow with login, logout, and a callback route? ' +
        'Is there a protected /dashboard page that checks the user session and redirects unauthenticated users to log in? ' +
        'Note: Next.js 16 supports both middleware.ts (export function middleware) and proxy.ts (export function proxy) — both are valid.',
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
    notContains(
      'withPageAuthRequired',
      'Does not use v3 withPageAuthRequired (v4 uses proxy/middleware)',
      GraderLevel.L5,
    ),
    notContains('withApiAuthRequired', 'Does not use v3 withApiAuthRequired (removed in v4)', GraderLevel.L5),
    judge(
      'Does the solution correctly integrate Auth0 into a Next.js App Router app ' +
        'using Auth0Client from @auth0/nextjs-auth0/server, proxy or middleware-based auth ' +
        'routing, and getSession for server-side session access? It should NOT use ' +
        'the deprecated v3 patterns like handleAuth, withPageAuthRequired, or /api/auth/ routes. ' +
        'Note: Next.js 16 replaces middleware.ts with proxy.ts (export function proxy) — both are valid. ' +
        'There should also be a protected /dashboard page that checks the session and ' +
        'redirects unauthenticated users to log in.',
      GraderLevel.L5,
    ),
    judge(
      'Does the source code rely on the v4 SDK configuration convention — instantiating Auth0Client so it reads ' +
        'the standard AUTH0_DOMAIN / AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET / AUTH0_SECRET environment variables (or passing ' +
        'those as options) — and avoid referencing the deprecated v3 names AUTH0_BASE_URL or AUTH0_ISSUER_BASE_URL anywhere in source? ' +
        'Judge only from the source code; do not assume the contents of any .env file.',
      GraderLevel.L5,
    ),
  ];
}
