import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA symbols present ──────────────────────────────────
    contains('isMfaRequiredError', 'Detects mfa_required via the isMfaRequiredError type guard', GraderLevel.L1),
    contains('mfa_token', 'Reads the MFA token off the error cause', GraderLevel.L1),
    contains('mfaToken', 'Passes the token to MFA methods as mfaToken', GraderLevel.L1),
    contains('listAuthenticators', 'Lists enrolled authenticators', GraderLevel.L1),
    contains('enrollAuthenticator', 'Enrolls a new authenticator', GraderLevel.L1),
    contains('challengeAuthenticator', 'Challenges an enrolled authenticator', GraderLevel.L1),
    contains('deleteAuthenticator', 'Removes an enrolled authenticator', GraderLevel.L1),
    contains('authenticatorTypes', 'Enrollment passes authenticatorTypes', GraderLevel.L1),
    contains('factorType', 'Verify passes the factorType discriminator', GraderLevel.L1),
    contains('barcodeUri', 'Surfaces the OTP barcodeUri for QR enrollment', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('mfa/associate', 'Does not hand-roll a call to the /mfa/associate endpoint', GraderLevel.L2),
    notContains('/oauth/token', 'Does not hand-roll a raw token grant', GraderLevel.L2),
    notContains('grant-type/mfa-otp', 'Does not build the MFA OTP grant type by hand', GraderLevel.L2),
    notContains('grant-type/mfa-oob', 'Does not build the MFA OOB grant type by hand', GraderLevel.L2),
    notContains('speakeasy', 'No server-side TOTP library (speakeasy)', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib)', GraderLevel.L2),
    notContains('@auth0/auth0-server-js', 'Does not pull in the sibling server SDK', GraderLevel.L2),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded Auth0 domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code avoid writing the MFA token, the OTP secret, the barcodeUri, or recovery codes ' +
        'to logs or to a persistent store? Returning the barcodeUri and secret in the HTTP response ' +
        'that starts enrollment is required and acceptable, as is returning a recovery code once. ' +
        'Only logging them (console.log and friends) or persisting them counts as a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    matches(String.raw`\.mfa\.verify\(`, 'Completes sign-in through the MFA client verify method', GraderLevel.L4),
    judge(
      'Does the code branch on whether the user already has a factor — enrolling an authenticator ' +
        'when they have none and challenging an existing one when they do — before verifying? ' +
        'Branching on mfa_requirements from the error cause and branching on the result of ' +
        'listAuthenticators are both acceptable.',
      GraderLevel.L4,
    ),
    judge(
      'Does the code support finishing sign-in with a recovery code, in addition to the ' +
        'authenticator-app code path?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      "Does every MFA operation go through the SDK client's mfa sub-client (enrollAuthenticator, " +
        'listAuthenticators, challengeAuthenticator, deleteAuthenticator, verify) rather than through ' +
        'hand-written fetch calls to Auth0 MFA endpoints or a hand-built MFA grant on /oauth/token?',
      GraderLevel.L5,
    ),
    judge(
      'Is the MFA token read from the error cause as snake_case mfa_token and then passed into the ' +
        'SDK options as camelCase mfaToken? Passing an option key named mfa_token to an SDK method ' +
        'is wrong — the option is mfaToken.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly use the MFA APIs of @auth0/auth0-auth-js — detecting mfa_required, ' +
        'lifting the MFA token from the error cause, and then enrolling, listing, challenging, ' +
        'deleting authenticators and verifying the submitted factor to obtain tokens?',
    ),
  ];
}
