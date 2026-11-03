import { contains, notContains, notContainsInSource, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Custom Token Exchange symbols present ──────────────────
    contains('customTokenExchange', 'Calls customTokenExchange', GraderLevel.L1),
    contains('subjectToken', 'Passes subjectToken', GraderLevel.L1),
    contains('subjectTokenType', 'Passes subjectTokenType', GraderLevel.L1),
    contains('urn:barkbook:external-idp-token', 'Wires the configured subjectTokenType', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ──────────────────────────────────
    notContains(
      '@auth0/auth0-spa-js',
      'No browser spa-js SDK in a React Native app — use react-native-auth0',
      GraderLevel.L2,
    ),
    notContains('@auth0/auth0-react', 'No React web SDK in a React Native app', GraderLevel.L2),
    notContains(
      'getSessionTransferToken',
      'Not session transfer — Custom Token Exchange uses customTokenExchange',
      GraderLevel.L2,
    ),
    notContains('client_secret', 'No client_secret in a public mobile client', GraderLevel.L2),
    notContains(
      'urn:ietf:params:oauth:grant-type:token-exchange',
      'No hand-rolled token-exchange grant — the SDK issues the /oauth/token call',
      GraderLevel.L2,
    ),

    // ── L3: Security ────────────────────────────────────────────────────────
    notContainsInSource('barkbook_secret', 'No client secret anywhere in a public client', GraderLevel.L3),
    judge(
      'Does the code let react-native-auth0 perform the exchange rather than hand-building an HTTP POST ' +
        'to /oauth/token, and does it avoid logging or persisting the raw partner subject token itself?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ──────────────────────────────────────────
    matches(
      String.raw`customTokenExchange\(\s*\{[\s\S]{0,200}subjectToken`,
      'customTokenExchange is called with a parameters object carrying subjectToken',
      GraderLevel.L4,
    ),
    judge(
      'Does the code call customTokenExchange from the useAuth0() hook (the same hook the existing login ' +
        'uses) — rather than constructing a standalone Auth0 class instance that would not update the ' +
        "hook's user state — passing a CustomTokenExchangeParameters object with subjectToken set to the " +
        'partner token and subjectTokenType set to urn:barkbook:external-idp-token, and awaiting the ' +
        'returned Credentials?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ────────────────────────────────────────────
    judge(
      'Is the exchange built with the current react-native-auth0 customTokenExchange method and its ' +
        'CustomTokenExchangeParameters object rather than a hand-rolled token request or a non-existent ' +
        'legacy method?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    judge(
      'Does the solution add a "Continue with Partner" flow to the React Native app using ' +
        'react-native-auth0 — calling customTokenExchange from the useAuth0() hook with subjectTokenType ' +
        'urn:barkbook:external-idp-token and the partner token as subjectToken, letting the SDK persist the ' +
        'resulting credentials — without a client secret, hand-rolling the grant, or pulling in a web Auth0 SDK?',
    ),
  ];
}
