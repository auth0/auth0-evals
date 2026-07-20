import { contains, notContains, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('@auth0/auth0-spa-js', 'Uses @auth0/auth0-spa-js SDK', GraderLevel.L1),
    contains('createAuth0Client', 'Initializes Auth0 with createAuth0Client', GraderLevel.L1),
    contains('loginWithRedirect', 'Implements loginWithRedirect', GraderLevel.L1),
    contains('handleRedirectCallback', 'Handles redirect callback on page load', GraderLevel.L1),
    contains('logout', 'Implements logout', GraderLevel.L1),
    contains('isAuthenticated', 'Checks isAuthenticated for conditional rendering', GraderLevel.L1),
    contains('getTokenSilently', 'Uses getTokenSilently to retrieve access token', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK ─────────────────────────────────────────
    notContains('@auth0/auth0-react', 'Does not use React SDK in vanilla JS app', GraderLevel.L2),
    notContains('@auth0/auth0-vue', 'Does not use Vue SDK in vanilla JS app', GraderLevel.L2),
    notContains('@auth0/nextjs-auth0', 'Does not use Next.js SDK in vanilla JS app', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in SPA (public client)', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens manually stored in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens manually stored in sessionStorage', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    // Event-based install/build verification temporarily disabled — see PR scoping discussion.
    // ranCommand('npm install', '@auth0/auth0-spa-js', 'Ran npm install for @auth0/auth0-spa-js', GraderLevel.L4),
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    matches(
      String.raw`createAuth0Client\s*\(\s*\{[\s\S]*?domain`,
      'Auth0Client configured with domain',
      GraderLevel.L4,
    ),
    matches(
      String.raw`Authorization.*Bearer`,
      'Authenticated API request uses Bearer token in Authorization header',
      GraderLevel.L4,
    ),
    judge(
      'Does the code check isAuthenticated to show/hide UI elements and only render ' +
        'user profile information when the user is authenticated?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    contains(
      'authorizationParams',
      'Uses authorizationParams (not deprecated top-level audience/redirect_uri)',
      GraderLevel.L5,
    ),
    matches(
      String.raw`audience.*api\.playground\.com`,
      "authorizationParams contains audience 'https://api.playground.com'",
      GraderLevel.L5,
    ),
    notContains('getTokenSilently().then', 'No deprecated promise-chain pattern for getTokenSilently', GraderLevel.L5),

    // ── Holistic judge ────────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a vanilla JavaScript SPA using @auth0/auth0-spa-js ' +
        'with createAuth0Client, loginWithRedirect, handleRedirectCallback, logout, user profile display, ' +
        'and getTokenSilently to make authenticated API calls?',
    ),
  ];
}
