import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

/**
 * `matches` runs against every workspace file concatenated as
 * `// FILE: <path>\n<content>` blocks, so a bare `manifestPlaceholders[\s\S]*?auth0Domain`
 * can straddle two files and pass on code that never touched build.gradle.
 *
 * This prefix anchors a pattern inside `android/app/build.gradle` by matching the
 * file header and then forbidding a further `// FILE:` marker, which keeps the
 * match from running past the end of that file.
 */
const IN_APP_GRADLE = String.raw`// FILE: android[\\/]app[\\/]build\.gradle\b(?:(?!// FILE:)[\s\S])*?`;

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('react-native-auth0', 'Uses the react-native-auth0 SDK', GraderLevel.L1),
    contains('Auth0Provider', 'Wraps app with Auth0Provider', GraderLevel.L1),
    contains('useAuth0', 'Uses the useAuth0 hook', GraderLevel.L1),
    contains('authorize', 'Implements login via authorize()', GraderLevel.L1),
    contains('clearSession', 'Implements logout via clearSession()', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('@auth0/auth0-react', 'No web React SDK (correct package is react-native-auth0)', GraderLevel.L2),
    notContains('@auth0/auth0-spa-js', 'No browser SPA SDK in a native React Native app', GraderLevel.L2),
    notContains('expo-auth-session', 'Does not use Expo AuthSession in a bare React Native app', GraderLevel.L2),
    notContains(
      'react-native-app-auth',
      'Does not fall back to the third-party react-native-app-auth library',
      GraderLevel.L2,
    ),
    notContains(
      'react-native-auth0/expo',
      'Does not register the Expo config plugin in a bare React Native app',
      GraderLevel.L2,
    ),

    // ── L3: Security checks ──────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in config)',
      GraderLevel.L3,
    ),
    notContains('AsyncStorage', 'Does not store tokens in insecure AsyncStorage', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    compiles('TypeScript typechecks (tsc --noEmit)', GraderLevel.L4),
    matches(String.raw`<Auth0Provider[\s\S]*?domain`, 'Auth0Provider configured with a domain prop', GraderLevel.L4),
    matches(
      IN_APP_GRADLE +
        String.raw`manifestPlaceholders(?:(?!// FILE:)[\s\S])*?auth0Domain["'\]\s]*[:=]\s*["']dev-barkbook\.us\.auth0\.com["']`,
      'android/app/build.gradle sets the auth0Domain manifestPlaceholder to the real tenant domain',
      GraderLevel.L4,
    ),
    matches(
      IN_APP_GRADLE + String.raw`auth0Scheme["'\]\s]*[:=]\s*["'](?:\$\{applicationId\}|com\.barkbook\.app)\.auth0["']`,
      'android/app/build.gradle sets the auth0Scheme manifestPlaceholder to <applicationId>.auth0',
      GraderLevel.L4,
    ),
    matches(
      String.raw`CFBundleURLSchemes[\s\S]*?PRODUCT_BUNDLE_IDENTIFIER`,
      'iOS Info.plist registers the bundle-identifier callback URL scheme',
      GraderLevel.L4,
    ),
    judge(
      'Does the code handle the loading state (isLoading from useAuth0) before rendering ' +
        'auth-dependent UI? A correct implementation should not render login/logout UI while isLoading is true.',
      GraderLevel.L4,
    ),
    judge(
      'Are BOTH native platforms configured for the Auth0 callback in this bare React Native app? ' +
        'Android needs auth0Domain and auth0Scheme manifestPlaceholders in android/app/build.gradle ' +
        '(the RedirectActivity is merged in by the SDK manifest, so declaring it manually is also acceptable), ' +
        'and iOS needs a CFBundleURLTypes entry in ios/scaffold/Info.plist. ' +
        'Answer no if only one platform was configured.',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    judge(
      'Does the code use the current react-native-auth0 v5 patterns? ' +
        'Specifically: the Auth0Provider + useAuth0 hook API rather than the legacy imperative ' +
        '`new Auth0({domain, clientId})` client class, and `user` from the hook rather than a ' +
        'manual getCredentials()/userInfo() call to read the profile.',
      GraderLevel.L5,
    ),

    // ── Holistic judge ───────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a bare (non-Expo) React Native app using the ' +
        'react-native-auth0 SDK: Auth0Provider wrapping the app with domain and clientId, the useAuth0 hook, ' +
        'authorize() for login and clearSession() for logout, native callback configuration for both Android ' +
        '(manifestPlaceholders) and iOS (CFBundleURLTypes), and the user profile displayed only after ' +
        'isLoading is false?',
    ),
  ];
}
