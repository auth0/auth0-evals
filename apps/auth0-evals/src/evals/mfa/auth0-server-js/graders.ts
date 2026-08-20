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
    contains('authenticatorTypes', 'Enrollment passes authenticatorTypes', GraderLevel.L1),
    contains('factorType', 'Verify passes the factorType discriminator', GraderLevel.L1),
    contains('barcodeUri', 'Surfaces the OTP barcodeUri for QR enrollment', GraderLevel.L1),
    contains('oobCode', 'SMS path carries the oobCode from the challenge into verify', GraderLevel.L1),
    contains('bindingCode', 'SMS verify passes the code the user typed in as bindingCode', GraderLevel.L1),
    contains('recoveryCode', 'Surfaces the recovery code returned by verify', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains(
      'deleteAuthenticator',
      'Does not call deleteAuthenticator — it does not exist on the server MFA client',
      GraderLevel.L2,
    ),
    notContains(
      '.authClient.mfa',
      'Does not bypass the server MFA client via the lower-level authClient',
      GraderLevel.L2,
    ),
    notContains(
      '@auth0/auth0-auth-js',
      'Does not reach past the server SDK to the lower-level package',
      GraderLevel.L2,
    ),
    notContains('mfa/associate', 'Does not hand-roll a call to the /mfa/associate endpoint', GraderLevel.L2),
    notContains('/oauth/token', 'Does not hand-roll a raw token grant', GraderLevel.L2),
    notContains('grant-type/mfa-otp', 'Does not build the MFA OTP grant type by hand', GraderLevel.L2),
    notContains('speakeasy', 'No server-side TOTP library (speakeasy)', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib)', GraderLevel.L2),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_session_secret_ghi789rst',
      'No hardcoded session secret in source files (ok in .env)',
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
      'Does the code avoid writing the MFA token, the OTP secret, the barcodeUri, or the recovery code ' +
        'to logs, and avoid putting the MFA token in a URL or query string? Rendering the barcodeUri and ' +
        'secret in the enrollment page, and showing the recovery code once, are required and acceptable. ' +
        'Holding the MFA token in a signed/httpOnly cookie or server-side session for the duration of ' +
        'the flow is also acceptable.',
      GraderLevel.L3,
    ),
    judge(
      'Does the code let the SDK persist the verified tokens in its configured state store, rather than ' +
        'keeping the access token or refresh token returned by verify in a module-level variable, ' +
        'an in-memory map, or a separate cookie of its own?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    matches(String.raw`\.mfa\.verify\(`, 'Completes sign-in through the MFA client verify method', GraderLevel.L4),
    judge(
      'Does the code branch on the result of listing the enrolled authenticators — enrolling an ' +
        'authenticator app when the list is empty and challenging an existing factor when it is not?',
      GraderLevel.L4,
    ),
    judge(
      'Is the request/response store options object passed as the second argument to the MFA verify ' +
        'call, so the verified session is written for this request? Verify is the only MFA method that ' +
        'takes store options; omitting it there is the defect being checked.',
      GraderLevel.L4,
    ),
    judge(
      'For an already-enrolled SMS factor, does the code issue a challenge first and then verify with ' +
        'the oobCode from that challenge plus the code the user typed in?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      "Does every MFA operation go through the server client's mfa sub-client (listAuthenticators, " +
        'enrollAuthenticator, challengeAuthenticator, verify) rather than through hand-written fetch ' +
        'calls to Auth0 MFA endpoints or a hand-built MFA grant on /oauth/token?',
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
      'Does the solution correctly use the MFA APIs of @auth0/auth0-server-js — catching mfa_required ' +
        'when fetching an access token, lifting the MFA token from the error cause, listing the ' +
        'enrolled authenticators, enrolling or challenging as appropriate, and verifying the submitted ' +
        'factor so the existing session becomes authenticated?',
    ),
  ];
}
