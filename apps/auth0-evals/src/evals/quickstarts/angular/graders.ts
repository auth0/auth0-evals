import { contains, notContains, matches, judge, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('@auth0/auth0-angular', 'Uses @auth0/auth0-angular SDK', GraderLevel.L1),
    contains('AuthService', 'Injects AuthService for authentication operations', GraderLevel.L1),
    contains('loginWithRedirect', 'Implements loginWithRedirect', GraderLevel.L1),
    contains('logout', 'Implements logout', GraderLevel.L1),
    contains('isAuthenticated$', 'Uses isAuthenticated$ observable for auth state', GraderLevel.L1),
    contains('user$', 'Uses user$ observable to display user profile', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('@auth0/auth0-react', 'Does not use React SDK in Angular app', GraderLevel.L2),
    notContains('@auth0/auth0-vue', 'Does not use Vue SDK in Angular app', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in SPA (public client, no secrets)', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens stored in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens stored in sessionStorage', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    matches(String.raw`provideAuth0\s*\(`, 'Auth0 configured via provideAuth0()', GraderLevel.L4),
    matches(
      String.raw`canActivate\s*:\s*\[?\s*(AuthGuard|authGuardFn)`,
      'Route protected with AuthGuard or authGuardFn',
      GraderLevel.L4,
    ),
    matches(
      String.raw`getAccessTokenSilently|httpInterceptor`,
      'Uses getAccessTokenSilently or httpInterceptor for authenticated API calls',
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

    // ── Holistic judge ────────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into an Angular SPA using @auth0/auth0-angular, ' +
        'with provideAuth0 setup, AuthService for login/logout, user profile display, ' +
        'route protection via a guard, and authenticated API calls (either by configuring ' +
        'authHttpInterceptorFn with an allowedList matching the API base URL, or by calling ' +
        'getAccessTokenSilently to retrieve tokens manually)?',
    ),
  ];
}
