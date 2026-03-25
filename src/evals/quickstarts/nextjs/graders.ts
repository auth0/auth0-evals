import { contains, notContains, notContainsInSource, matches, judge } from '../../../agent_eval/graders.js';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('@auth0/nextjs-auth0', 'Uses @auth0/nextjs-auth0 SDK'),
    contains('AUTH0_CLIENT_ID', 'Configures AUTH0_CLIENT_ID'),
    contains('AUTH0_CLIENT_SECRET', 'Configures AUTH0_CLIENT_SECRET'),
    contains('AUTH0_SECRET', 'Configures AUTH0_SECRET'),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('@auth0/nextjs-sdk', 'No hallucinated @auth0/nextjs-sdk package'),
    notContains('@auth0/nextjs', "No hallucinated @auth0/nextjs (must be @auth0/nextjs-auth0)"),
    notContains('@auth0/auth0-react', 'Does not use SPA SDK in server app'),

    // ── L3: Security checks ──────────────────────────────────────────────────
    notContainsInSource('barkbook_secret_def456uvw', 'No hardcoded client secret in source files (ok in .env)'),
    notContainsInSource('barkbook_client_abc123xyz', 'No hardcoded client ID in source files (ok in .env)'),
    judge(
      'Are all Auth0 credentials (domain, client ID, client secret, AUTH0_SECRET) ' +
        'stored in environment variables or .env files, not hardcoded in source code?',
      'nextjs',
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    matches(
      String.raw`export\s+(default\s+)?function\s+middleware`,
      'Middleware function is exported from middleware file',
    ),
    judge(
      'Does the code set up a working authentication flow with login, logout, and a callback route? ' +
        'Is there a protected page or route that checks the user session?',
      'nextjs',
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    judge(
      'Does the code use the current @auth0/nextjs-auth0 SDK patterns? ' +
        'Specifically: does it use Auth0Client() factory or the auth0() instance, ' +
        'and NOT the deprecated v3 handleAuth() route handler or UserProvider?',
      'nextjs',
    ),
    judge(
      'Does the code use current v4 environment variable names (AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET) ' +
        'and NOT deprecated v3 names (AUTH0_BASE_URL, AUTH0_ISSUER_BASE_URL)?',
      'nextjs',
    ),
  ];
}
