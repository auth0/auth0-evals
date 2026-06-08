import { contains, notContains, matches, judge, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('@auth0/auth0-vue', 'Uses @auth0/auth0-vue SDK', GraderLevel.L1),
    contains('createAuth0', 'Sets up Auth0 plugin with createAuth0', GraderLevel.L1),
    contains('useAuth0', 'Uses useAuth0 composable', GraderLevel.L1),
    contains('loginWithRedirect', 'Implements loginWithRedirect', GraderLevel.L1),
    contains('logout', 'Implements logout', GraderLevel.L1),
    contains('isAuthenticated', 'Checks isAuthenticated for conditional rendering', GraderLevel.L1),
    contains('user', 'Displays user profile information', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('@auth0/auth0-react', 'Does not use React SDK in Vue app', GraderLevel.L2),
    notContains('@auth0/vue3-auth0', 'No hallucinated @auth0/vue3-auth0 package', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in SPA (public client, no secrets)', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens stored in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens stored in sessionStorage', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    // Event-based install/build verification temporarily disabled — see PR scoping discussion.
    // ranCommand('npm install', '@auth0/auth0-vue', 'Ran npm install for @auth0/auth0-vue', GraderLevel.L4),
    // ranCommand('npm run', 'build', 'Ran build to verify compilation', GraderLevel.L4),
    matches(String.raw`app\.use\s*\(\s*createAuth0`, 'Plugin installed via app.use(createAuth0(...))', GraderLevel.L4),
    contains('getAccessTokenSilently', 'Uses getAccessTokenSilently to retrieve access token', GraderLevel.L4),
    judge(
      'Does the code handle the loading state (isLoading) before checking isAuthenticated? ' +
        'A correct implementation should not render auth-dependent UI while isLoading is true.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    contains(
      'authorizationParams',
      'Uses authorizationParams (not deprecated top-level redirect_uri/audience)',
      GraderLevel.L5,
    ),
    matches(
      String.raw`audience.*api\.playground\.com`,
      "authorizationParams contains audience 'https://api.playground.com'",
      GraderLevel.L5,
    ),
    notContains('client_id:', 'Uses clientId (not deprecated client_id) in createAuth0 config', GraderLevel.L5),

    // ── Holistic judge ────────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a Vue 3 SPA with the @auth0/auth0-vue plugin, ' +
        'useAuth0 composable, login, logout, user profile display, route protection, and ' +
        'getAccessTokenSilently to make authenticated API calls?',
    ),
  ];
}
