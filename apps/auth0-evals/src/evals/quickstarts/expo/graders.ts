import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('react-native-auth0', 'Uses the react-native-auth0 SDK', GraderLevel.L1),
    contains('Auth0Provider', 'Wraps app with Auth0Provider', GraderLevel.L1),
    contains('useAuth0', 'Uses the useAuth0 hook', GraderLevel.L1),
    contains('authorize', 'Implements login via authorize()', GraderLevel.L1),
    contains('clearSession', 'Implements logout via clearSession()', GraderLevel.L1),
    contains('customScheme', 'Configures a customScheme for the callback URL', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('@auth0/auth0-react', 'No web React SDK (correct package is react-native-auth0)', GraderLevel.L2),
    notContains('@auth0/auth0-spa-js', 'No browser SPA SDK in a native Expo app', GraderLevel.L2),
    notContains(
      'expo-auth-session',
      'Does not fall back to expo-auth-session instead of the Auth0 SDK',
      GraderLevel.L2,
    ),

    // ── L3: Security checks ──────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in app.json)',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    compiles('TypeScript typechecks (tsc --noEmit)', GraderLevel.L4),
    matches(
      String.raw`react-native-auth0[\s\S]*?customScheme`,
      'Registers the react-native-auth0 Expo config plugin with a customScheme in app.json',
      GraderLevel.L4,
    ),
    matches(String.raw`<Auth0Provider[\s\S]*?domain`, 'Auth0Provider configured with a domain prop', GraderLevel.L4),
    judge(
      'Does the code handle the loading state (isLoading from useAuth0) before rendering ' +
        'auth-dependent UI? A correct implementation should not render login/logout UI while isLoading is true.',
      GraderLevel.L4,
    ),
    judge(
      'Does the code wire login and logout correctly for react-native-auth0 on Expo? ' +
        'Specifically: authorize() for login and clearSession() for logout, each passing ' +
        '{ customScheme: ... } as the second argument, matching the scheme configured in the app.json plugin.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    judge(
      'Does the code use the current react-native-auth0 v5 Expo patterns? ' +
        'Specifically: the Auth0Provider + useAuth0 hook API (not the legacy imperative Auth0 client class), ' +
        'and the react-native-auth0 Expo config plugin in app.json (not manual native iOS/Android edits)?',
      GraderLevel.L5,
    ),

    // ── Holistic judge ───────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into an Expo app with the react-native-auth0 SDK: ' +
        'Auth0Provider wrapping the app, the useAuth0 hook, authorize()/clearSession() login and logout with ' +
        'customScheme, the Expo config plugin registered in app.json, and user profile display guarded by isLoading?',
    ),
  ];
}
