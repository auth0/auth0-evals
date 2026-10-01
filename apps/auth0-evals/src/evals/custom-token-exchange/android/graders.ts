import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Custom Token Exchange symbols present ──────────────────
    contains('customTokenExchange', 'Calls AuthenticationAPIClient#customTokenExchange', GraderLevel.L1),
    contains('subjectTokenType', 'Passes the subjectTokenType argument', GraderLevel.L1),
    contains('subjectToken', 'Passes the subjectToken argument', GraderLevel.L1),
    contains('urn:barkbook:external-idp-token', 'Wires the configured subjectTokenType', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated JS package in an Android app', GraderLevel.L2),
    notContains('auth0-java', 'No auth0-java (server-side SDK, not for Android)', GraderLevel.L2),
    notContains(
      'loginWithNativeSocialToken',
      'No legacy native-social-token login — Custom Token Exchange uses customTokenExchange',
      GraderLevel.L2,
    ),
    notContains('client_secret', 'No client_secret in a public mobile client', GraderLevel.L2),
    notContains(
      'urn:ietf:params:oauth:grant-type:token-exchange',
      'No hand-rolled token-exchange grant — the SDK issues the /oauth/token call',
      GraderLevel.L2,
    ),

    // ── L3: Security ────────────────────────────────────────────────────────
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
    judge(
      'Does the code let SecureCredentialsManager (or CredentialsManager) store the Credentials returned ' +
        'by the exchange rather than persisting tokens by hand in plain SharedPreferences, and does it ' +
        'avoid hand-building an HTTP POST to /oauth/token instead of using the SDK method?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    judge(
      'Does the code call AuthenticationAPIClient#customTokenExchange with the arguments in the correct ' +
        'order — subjectTokenType (urn:barkbook:external-idp-token) FIRST, then subjectToken (the partner ' +
        'token) — rather than transposing them as the legacy loginWithNativeSocialToken(token, tokenType) ' +
        'order would, and does it chain validateClaims() before starting the request?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code execute the request (via start with a Callback or the await coroutine extension) and ' +
        'on success hand the resulting Credentials to SecureCredentialsManager or CredentialsManager?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Is the exchange built with the current AuthenticationAPIClient#customTokenExchange builder (with ' +
        'validateClaims) rather than the legacy loginWithNativeSocialToken path or a hand-built token request?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add Custom Token Exchange to the Android app using Auth0.Android — ' +
        'calling customTokenExchange with subjectTokenType urn:barkbook:external-idp-token and the partner ' +
        'token as subjectToken in that argument order, validating claims, and storing the returned ' +
        'Credentials via SecureCredentialsManager — without a client secret, hand-rolling the grant, or ' +
        'using the legacy native-social-token login?',
    ),
  ];
}
