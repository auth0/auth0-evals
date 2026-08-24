import { contains, notContains, notContainsInSource, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('acr_values', 'Step-up request uses acr_values parameter', GraderLevel.L1),
    contains('amr', 'AMR claim checked to detect prior MFA completion', GraderLevel.L1),
    contains(
      'schemas.openid.net/pape/policies/2007/06/multi-factor',
      'Uses correct multi-factor acr_values policy URI',
      GraderLevel.L1,
    ),
    contains('withParameters', 'Passes acr_values through WebAuthProvider withParameters', GraderLevel.L1),
    // The SDK surfaces custom claims through UserProfile.getExtraInfo(); the separate
    // com.auth0.android:jwtdecode library is an equally valid way to read amr.
    matches(
      String.raw`getExtraInfo\(\)|com\.auth0\.android:jwtdecode`,
      'Reads ID token claims via UserProfile.getExtraInfo() or the jwtdecode library',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('auth0-java', 'No auth0-java (server-side SDK, not for Android)', GraderLevel.L2),
    // Auth0.Android has no Credentials.claims property — claims come from credentials.user.
    notContains('credentials.claims', 'No hallucinated Credentials.claims property', GraderLevel.L2),
    // Every embedded-MFA path carries the mfa_token, whether or not the
    // MfaApiClient type is ever named.
    notContains(
      'mfaToken',
      'Does not use the embedded MFA grant (MfaApiClient) — wrong approach for a Universal Login app',
      GraderLevel.L2,
      { caseSensitive: false },
    ),
    notContains('mfa/challenge', 'Does not call the raw MFA challenge endpoint', GraderLevel.L2),

    // ── L3: Security ──────────────────────────────────────────────────────
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
      'Does the code let SecureCredentialsManager (or CredentialsManager) handle token storage rather than ' +
        'persisting Auth0 tokens (access tokens, ID tokens, refresh tokens) by hand in SharedPreferences? ' +
        'Storing application state such as a pending transfer is acceptable — only manual token storage is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    judge(
      'Does the code check the amr claim before executing the transfer action, and only proceed when ' +
        '"mfa" is present in the amr array? Reading amr via credentials.user.getExtraInfo()["amr"] or via ' +
        'the com.auth0.android:jwtdecode library are both acceptable.',
      GraderLevel.L4,
    ),
    judge(
      'When MFA is missing, is step-up performed by launching a new WebAuthProvider.login(...) — with ' +
        'withScheme and the MFA acr_values — rather than by calling the Authentication API MFA endpoints ' +
        '(challenge/verify) directly?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the step-up request force fresh authentication with a max_age of 0, so a cached session is not ' +
        'reused? Either the dedicated withMaxAge(0) builder or a "max_age" entry inside withParameters(...) counts.',
      GraderLevel.L5,
    ),
    judge(
      'Is the step-up request built with the current v2+ builder API — WebAuthProvider.login(account) ' +
        'with withScheme and withParameters/withMaxAge — rather than by hand-building an /authorize URL ' +
        'or using the removed WebAuthProvider.init entry point?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up authentication in an Android app — reading the amr ' +
        'claim from the ID token (via credentials.user.getExtraInfo() or the jwtdecode library), requesting ' +
        'step-up through WebAuthProvider.login with acr_values and max_age 0 when MFA is not present, and ' +
        'gating the Transfer Funds action behind MFA verification?',
    ),
  ];
}
