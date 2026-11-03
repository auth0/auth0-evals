import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Custom Token Exchange symbols present ──────────────────
    contains('customTokenExchange', 'Calls the Authentication customTokenExchange method', GraderLevel.L1),
    contains('subjectToken', 'Passes the subjectToken argument', GraderLevel.L1),
    contains('subjectTokenType', 'Passes the subjectTokenType argument', GraderLevel.L1),
    contains('urn:barkbook:external-idp-token', 'Wires the configured subjectTokenType', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated JS package in a Swift app', GraderLevel.L2),
    notContains('Auth0SDK', 'No hallucinated Auth0SDK module name (correct module is Auth0)', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in a public mobile client', GraderLevel.L2),
    notContains(
      'urn:ietf:params:oauth:grant-type:token-exchange',
      'No hand-rolled token-exchange grant — the SDK issues the /oauth/token call',
      GraderLevel.L2,
    ),

    // ── L3: Security ────────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in Swift source files (ok in Auth0.plist)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in Swift source files (ok in Auth0.plist)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code let CredentialsManager store the Auth0 credentials returned by the exchange rather ' +
        'than persisting tokens by hand in UserDefaults or the Keychain, and does it avoid hand-building a ' +
        'URLSession POST to /oauth/token instead of using the SDK method?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    judge(
      'Does the code call Auth0.authentication().customTokenExchange with subjectToken set to the partner ' +
        'token and subjectTokenType set to urn:barkbook:external-idp-token, start the request (via start or ' +
        'the async variant), and on success hand the resulting Credentials to CredentialsManager?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Is the exchange built with the current Authentication API customTokenExchange method rather than ' +
        'the native-social-token login path or a hand-built /authorize or /oauth/token request?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution correctly add Custom Token Exchange to the iOS app using Auth0.swift — calling ' +
        'Auth0.authentication().customTokenExchange with the partner token as subjectToken and ' +
        'subjectTokenType urn:barkbook:external-idp-token, and storing the returned Credentials via ' +
        'CredentialsManager — without a client secret, hand-rolling the grant, or storing tokens by hand?',
    ),
  ];
}
