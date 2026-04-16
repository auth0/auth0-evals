import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  GraderLevel,
} from '../../../agent_eval/graders.js';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('com.auth0.android:auth0', 'Uses Auth0 Android SDK dependency', GraderLevel.L1),
    contains('WebAuthProvider', 'Uses WebAuthProvider for authentication', GraderLevel.L1),
    contains('WebAuthProvider.login', 'Calls WebAuthProvider.login() for sign-in', GraderLevel.L1),
    contains('WebAuthProvider.logout', 'Calls WebAuthProvider.logout() for sign-out', GraderLevel.L1),
    contains('CredentialsManager', 'Uses CredentialsManager for secure token storage', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('auth0-java', 'No auth0-java (server-side SDK, not for Android)', GraderLevel.L2),

    // ── L3 ───────────────────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in Kotlin source files (ok in strings.xml)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in Kotlin source files (ok in strings.xml)',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    contains(
      'manifestPlaceholders',
      'Configures manifestPlaceholders in build.gradle for Auth0 callback URL scheme',
      GraderLevel.L4,
    ),
    judge(
      'Does the code properly handle the login and logout callback flows with error handling ' +
        'for AuthenticationException? Does it update UI state after a successful or failed authentication?',
      'android',
      GraderLevel.L4,
    ),
    judge(
      'Is the Auth0 redirect activity or manifestPlaceholders correctly configured so the callback URL ' +
        '(com.auth0.android:auth0 redirect scheme) is handled by the app after the browser returns?',
      'android',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    matches(
      String.raw`Auth0\s*(\.\s*getInstance\s*)?\(\s*(?:this(?:@[A-Za-z_][A-Za-z0-9_]*)?|context|applicationContext|requireContext\(\))\s*\)`,
      'Uses Auth0(context) or Auth0.getInstance(context) for auto-configuration from string resources',
      GraderLevel.L5,
    ),
    judge(
      'Does the code use current Auth0 Android SDK v2+ patterns? ' +
        'Specifically: Auth0(context) for auto-configuration from strings.xml, ' +
        'WebAuthProvider for browser-based login/logout, and CredentialsManager for ' +
        'secure credential storage rather than persisting tokens manually in SharedPreferences?',
      'android',
      GraderLevel.L5,
    ),

    // ── Holistic judge ───────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into an Android app with ' +
        'WebAuthProvider login and logout, CredentialsManager for secure token storage, ' +
        'Auth0 credentials configured via string resources, manifestPlaceholders for callback URL ' +
        'handling, and appropriate UI state management after authentication?',
      'android',
    ),
  ];
}
