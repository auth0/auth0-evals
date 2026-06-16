import { contains, notContains, matches, judge, compiles, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('@auth0/auth0-react', 'Uses @auth0/auth0-react SDK', GraderLevel.L1),
    contains('Auth0Provider', 'Wraps app with Auth0Provider', GraderLevel.L1),
    contains('useAuth0', 'Uses useAuth0 hook', GraderLevel.L1),
    contains('loginWithRedirect', 'Implements loginWithRedirect', GraderLevel.L1),
    contains('logout', 'Implements logout', GraderLevel.L1),
    contains('isAuthenticated', 'Checks isAuthenticated for conditional rendering', GraderLevel.L1),
    matches(String.raw`user\??\.name`, 'Displays user profile name', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('@auth0/react', 'No hallucinated @auth0/react package (must be @auth0/auth0-react)', GraderLevel.L2),
    notContains('@auth0/nextjs-auth0', 'Does not use server SDK in SPA app', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in SPA (public client, no secrets)', GraderLevel.L2),

    // ── L3: Security checks ──────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens stored in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens stored in sessionStorage', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    // Event-based install/build verification temporarily disabled — see PR scoping discussion.
    // ranCommand('npm install', '@auth0/auth0-react', 'Ran npm install for @auth0/auth0-react', GraderLevel.L4),
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    matches(String.raw`<Auth0Provider[\s\S]*?domain`, 'Auth0Provider configured with domain prop', GraderLevel.L4),
    contains('getAccessTokenSilently', 'Uses getAccessTokenSilently to retrieve access token', GraderLevel.L4),
    judge(
      'Does the code handle the loading state (isLoading) before checking isAuthenticated? ' +
        'A correct implementation should not render auth-dependent UI while isLoading is true.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    contains('authorizationParams', 'Uses authorizationParams (not audience directly on provider)', GraderLevel.L5),
    matches(
      String.raw`audience.*api\.barkbook\.com`,
      "authorizationParams contains audience 'https://api.barkbook.com'",
      GraderLevel.L5,
    ),
    judge(
      'Does the code use the current @auth0/auth0-react SDK patterns? ' +
        'Specifically: does it use isLoading (not the deprecated "loading" property), ' +
        'and pass audience/scope via authorizationParams object (not as direct props)?',
      GraderLevel.L5,
    ),

    // ── Holistic judge ───────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a React SPA with Auth0Provider, ' +
        'useAuth0 hook, login, logout, user profile display, and getAccessTokenSilently ' +
        'to make authenticated API calls?',
    ),
  ];
}
