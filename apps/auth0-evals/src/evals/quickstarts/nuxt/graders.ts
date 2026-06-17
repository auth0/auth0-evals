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
    contains('@auth0/auth0-nuxt', 'Uses @auth0/auth0-nuxt SDK', GraderLevel.L1),
    contains('modules:', 'Registers module in nuxt.config', GraderLevel.L1),
    contains('runtimeConfig', 'Configures runtimeConfig with Auth0 settings', GraderLevel.L1),
    contains('NUXT_AUTH0_DOMAIN', 'Configures NUXT_AUTH0_DOMAIN env var', GraderLevel.L1),
    contains('NUXT_AUTH0_CLIENT_ID', 'Configures NUXT_AUTH0_CLIENT_ID env var', GraderLevel.L1),
    contains('NUXT_AUTH0_CLIENT_SECRET', 'Configures NUXT_AUTH0_CLIENT_SECRET env var', GraderLevel.L1),
    contains('NUXT_AUTH0_SESSION_SECRET', 'Configures NUXT_AUTH0_SESSION_SECRET env var', GraderLevel.L1),
    contains('useUser', 'Uses useUser() composable to access the authenticated user', GraderLevel.L1),
    contains('/auth/login', 'Uses /auth/login route to initiate login', GraderLevel.L1),
    contains('/auth/logout', 'Uses /auth/logout route to log out', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('@auth0/auth0-vue', 'Does not use the Vue SDK in a Nuxt app', GraderLevel.L2),
    notContains('@auth0/auth0-react', 'Does not use the React SDK in a Nuxt app', GraderLevel.L2),
    notContains('loginWithRedirect', 'Does not use loginWithRedirect (SPA API not applicable to Nuxt)', GraderLevel.L2),
    notContains(
      'getAccessTokenSilently',
      'Does not use getAccessTokenSilently (Vue/React SPA API, not used in Nuxt)',
      GraderLevel.L2,
    ),

    // ── L3: Security checks ───────────────────────────────────────────────────
    notContainsInSource(
      'playground_client_abc123xyz',
      'No hardcoded client ID in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'playground_secret_def456uvw',
      'No hardcoded client secret in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-playground.us.auth0.com',
      'No hardcoded Auth0 domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContains('localStorage.setItem', 'No tokens stored in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens stored in sessionStorage', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    // Event-based install/build verification temporarily disabled — see PR scoping discussion.
    // ranCommand('npm install', '@auth0/auth0-nuxt', 'Ran npm install for @auth0/auth0-nuxt', GraderLevel.L4),
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    wroteFile('.env', 'Wrote Auth0 credentials to .env file', GraderLevel.L4, [
      'dev-playground.us.auth0.com',
      'playground_client_abc123xyz',
      'playground_secret_def456uvw',
    ]),
    matches(
      String.raw`modules:\s*\[[\s\S]*['"]@auth0\/auth0-nuxt['"]`,
      'Module correctly registered in the modules array',
      GraderLevel.L4,
    ),
    contains('sessionSecret', 'sessionSecret configured for session encryption', GraderLevel.L4),
    contains('clientSecret', 'clientSecret configured (Regular Web Application)', GraderLevel.L4),
    contains('appBaseUrl', 'appBaseUrl configured in runtimeConfig', GraderLevel.L4),
    contains('definePageMeta', 'definePageMeta used for page-level middleware', GraderLevel.L4),
    judge(
      'Is there a protected /profile route that uses a Nuxt route middleware (via definePageMeta) ' +
        'to check authentication with useUser() and redirect unauthenticated users to /auth/login?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    contains('audience', 'Audience configured in runtimeConfig for API access', GraderLevel.L5),
    matches(String.raw`audience.*api\.playground\.com`, "Audience set to 'https://api.playground.com'", GraderLevel.L5),
    contains('getAccessToken', 'Uses getAccessToken() server-side to retrieve access token', GraderLevel.L5),
    contains('useAuth0', 'Uses useAuth0(event) server-side composable', GraderLevel.L5),

    // ── Holistic judge ────────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a Nuxt application using the @auth0/auth0-nuxt module, ' +
        'with proper configuration in nuxt.config.ts (domain, clientId, clientSecret, sessionSecret, appBaseUrl, audience), ' +
        'login/logout via /auth/login and /auth/logout, user profile display with useUser(), ' +
        'a /profile route protected by a route middleware, and server-side getAccessToken() for authenticated API calls?',
    ),
  ];
}
