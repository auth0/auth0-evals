import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and imperative client API) ─────────
    contains('react-native-auth0', 'Uses the react-native-auth0 SDK', GraderLevel.L1),
    matches(String.raw`new\s+Auth0\s*\(`, 'Instantiates the Auth0 client class directly', GraderLevel.L1),
    contains('webAuth', 'Uses the client webAuth interface', GraderLevel.L1),
    contains('authorize', 'Implements login via webAuth.authorize()', GraderLevel.L1),
    contains('clearSession', 'Implements logout via webAuth.clearSession()', GraderLevel.L1),
    contains('customScheme', 'Configures a customScheme for the callback URL', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('@auth0/auth0-react', 'No web React SDK (correct package is react-native-auth0)', GraderLevel.L2),
    notContains('@auth0/auth0-spa-js', 'No browser SPA SDK in a native Expo app', GraderLevel.L2),
    notContains(
      'expo-auth-session',
      'Does not fall back to expo-auth-session instead of the Auth0 SDK',
      GraderLevel.L2,
    ),
    // This variant asks for the imperative client, not the React context API.
    notContains('useAuth0', 'Does not use the useAuth0 hook (this variant requires the client class)', GraderLevel.L2),
    notContains('Auth0Provider', 'Does not use Auth0Provider (this variant requires the client class)', GraderLevel.L2),

    // ── L3: Security checks ──────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in app.json)',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    compiles('Android build succeeds (expo prebuild + gradle assembleDebug)', GraderLevel.L4),
    matches(
      String.raw`react-native-auth0[\s\S]*?customScheme`,
      'Registers the react-native-auth0 Expo config plugin with a customScheme in app.json',
      GraderLevel.L4,
    ),
    matches(
      String.raw`new\s+Auth0\s*\(\s*\{[\s\S]*?domain`,
      'Auth0 client constructed with a domain option',
      GraderLevel.L4,
    ),
    judge(
      'Does the code construct a single Auth0 client instance (new Auth0({ domain, clientId })) and reuse it, ' +
        'rather than creating a new client on every render or button press?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code wire login and logout correctly through the imperative Auth0 client on Expo? ' +
        'Specifically: auth0.webAuth.authorize(...) for login and auth0.webAuth.clearSession(...) for logout, ' +
        'each passing a customScheme that matches the scheme configured in the app.json plugin, with the results ' +
        'used to update component state?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    judge(
      'Does the code use the current react-native-auth0 v5 imperative client patterns? ' +
        'Specifically: the default-exported Auth0 client class with the webAuth interface (authorize/clearSession) ' +
        'and credentialsManager for token storage, using async/await (not deprecated completion-callback signatures), ' +
        'and the react-native-auth0 Expo config plugin in app.json (not manual native iOS/Android edits)?',
      GraderLevel.L5,
    ),

    // ── Holistic judge ───────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into an Expo app using the imperative react-native-auth0 client: ' +
        'a directly instantiated Auth0 client, webAuth.authorize()/webAuth.clearSession() for login and logout with ' +
        'customScheme, the Expo config plugin registered in app.json, and authenticated UI state driven by the results?',
    ),
  ];
}
