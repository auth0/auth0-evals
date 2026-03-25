import { contains, notContains, notContainsInSource, matches, judge } from '../../../agent_eval/graders.js';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('@auth0/auth0-react', 'Uses @auth0/auth0-react SDK'),
    contains('Auth0Provider', 'Wraps app with Auth0Provider'),
    contains('useAuth0', 'Uses useAuth0 hook'),
    contains('loginWithRedirect', 'Implements loginWithRedirect'),
    contains('logout', 'Implements logout'),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('@auth0/react', 'No hallucinated @auth0/react package (must be @auth0/auth0-react)'),
    notContains('@auth0/nextjs-auth0', 'Does not use server SDK in SPA app'),
    notContains('client_secret', 'No client_secret in SPA (public client, no secrets)'),

    // ── L3: Security checks ──────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens stored in localStorage'),
    notContains('sessionStorage.setItem', 'No tokens stored in sessionStorage'),
    notContainsInSource('barkbook_client_abc123xyz', 'No hardcoded client ID in source files'),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    matches(String.raw`<Auth0Provider[\s\S]*?domain`, 'Auth0Provider configured with domain prop'),
    judge(
      'Does the code handle the loading state (isLoading) before checking isAuthenticated? ' +
        'A correct implementation should not render auth-dependent UI while isLoading is true.',
      'react',
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    contains('authorizationParams', 'Uses authorizationParams (not audience directly on provider)'),
    judge(
      'Does the code use the current @auth0/auth0-react SDK patterns? ' +
        'Specifically: does it use isLoading (not the deprecated "loading" property), ' +
        'and pass audience/scope via authorizationParams object (not as direct props)?',
      'react',
    ),

    // ── Holistic judge ───────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a React SPA with Auth0Provider, ' +
        'useAuth0 hook, login, logout, and user profile display?',
      'react',
    ),
  ];
}
