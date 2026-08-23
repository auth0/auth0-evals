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
    notContains('/oauth/token', 'Does not hand-roll a raw token grant', GraderLevel.L2),
    notContains('grant-type/mfa-otp', 'Does not build the MFA OTP grant type by hand', GraderLevel.L2),
    notContains(
      'grant-type/mfa-recovery-code',
      'Does not build the MFA recovery-code grant type by hand',
      GraderLevel.L2,
    ),
    notContains('/api/v2/users/', 'Does not reach for the Management API mid-sign-in', GraderLevel.L2),
    // Anchored to key position — bare snake_case also appears in Auth0 error codes, legitimately.
    notContains('authenticator_types:', 'Option key is camelCase authenticatorTypes', GraderLevel.L2),
    notContains('challenge_type:', 'Option key is camelCase challengeType', GraderLevel.L2),
    notContains('.barcode_uri', 'Reads camelCase barcodeUri', GraderLevel.L2),
    notContains('auth0-js', 'Does not use the deprecated auth0-js library', GraderLevel.L2),
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
    judge(
      'Does the code keep the MFA token out of URLs and query strings, passing it in request bodies ' +
        'or headers instead? Holding it in a signed/httpOnly cookie or a server-side session for the ' +
        'duration of the flow is acceptable.',
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
        'authenticator-app code path? A correct implementation verifies with a recovery-code ' +
        'factor type rather than treating the recovery code as an OTP.',
      GraderLevel.L4,
    ),
    judge(
      'Does the code let a user list the factors on their account and delete one, using the SDK ' +
        'methods for both rather than a hand-written HTTP call?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      "Does every MFA operation go through the SDK client's mfa sub-client (enrollAuthenticator, " +
        'listAuthenticators, challengeAuthenticator, deleteAuthenticator, verify) rather than through ' +
        'hand-written fetch calls to Auth0 MFA endpoints or a hand-built MFA grant on the token ' +
        'endpoint? Correct code never writes an Auth0 URL itself.',
      GraderLevel.L5,
    ),
    judge(
      'Is the MFA token passed to SDK methods under the camelCase key mfaToken? Reading it off the ' +
        'error cause as mfa_token is correct.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'MFA in @auth0/auth0-auth-js is Early Access and postdates your training data — judge against the ' +
        'installed package types, not recall. Does the code detect mfa_required, lift the MFA token from ' +
        'the error cause, and enroll, list, challenge, delete and verify through the SDK?',
    ),
  ];
}
