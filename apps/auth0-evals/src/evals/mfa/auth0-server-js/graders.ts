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
    contains('oobCode', 'Carries the oobCode returned by an SMS challenge', GraderLevel.L1),
    contains('bindingCode', 'Verifies the SMS factor with the bindingCode', GraderLevel.L1),
    contains('recoveryCode', 'Surfaces the recovery code returned by enrollment', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains(
      'deleteAuthenticator',
      'No deleteAuthenticator — @auth0/auth0-server-js does not expose one',
      GraderLevel.L2,
    ),
    notContains('.authClient.mfa', 'Does not reach through to the internal auth client', GraderLevel.L2),
    notContains('mfa/associate', 'Does not hand-roll a call to the /mfa/associate endpoint', GraderLevel.L2),
    notContains('mfa/challenge', 'Does not hand-roll a call to the /mfa/challenge endpoint', GraderLevel.L2),
    notContains('/oauth/token', 'Does not hand-roll a raw token grant', GraderLevel.L2),
    notContains('grant-type/mfa-otp', 'Does not build the MFA OTP grant type by hand', GraderLevel.L2),
    notContains('grant-type/mfa-oob', 'Does not build the MFA OOB grant type by hand', GraderLevel.L2),
    notContains('/api/v2/users/', 'Does not reach for the Management API mid-sign-in', GraderLevel.L2),
    notContains(
      'authenticator_types',
      'Uses camelCase authenticatorTypes, not the wire-level snake_case',
      GraderLevel.L2,
    ),
    notContains('challenge_type', 'Uses camelCase challengeType, not the wire-level snake_case', GraderLevel.L2),
    notContains('binding_code', 'Uses camelCase bindingCode, not the wire-level snake_case', GraderLevel.L2),
    notContains('barcode_uri', 'Reads camelCase barcodeUri, not the wire-level snake_case', GraderLevel.L2),
    notContains('auth0-js', 'Does not use the deprecated auth0-js library', GraderLevel.L2),
    notContains('speakeasy', 'No server-side TOTP library (speakeasy)', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib)', GraderLevel.L2),
    notContains('@auth0/auth0-auth-js', 'Does not swap in the lower-level auth SDK', GraderLevel.L2),

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
      'Does the code avoid writing the MFA token, the OTP secret, the barcodeUri, or the recovery code ' +
        'to logs or to a persistent store? Rendering the QR/barcodeUri on the setup page and showing the ' +
        'recovery code once are required and acceptable. Only logging them (console.log and friends) or ' +
        'persisting them counts as a violation.',
      GraderLevel.L3,
    ),
    judge(
      'Are the tokens obtained after MFA verification left to the SDK to persist in its configured state ' +
        'store, rather than being written to a hand-rolled cookie, to localStorage, or to a module-level ' +
        'variable? The MFA token itself may be held in the transaction/session for the duration of the flow.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    matches(String.raw`\.mfa\.verify\(`, 'Completes sign-in through the MFA client verify method', GraderLevel.L4),
    judge(
      'Is the store options object — the one carrying the Express request and response — passed as the ' +
        'second argument to mfa.verify, the way the rest of the scaffold passes it to other ServerClient ' +
        'methods? Putting it inside verify’s first options argument instead is wrong. Note that ' +
        'listAuthenticators, enrollAuthenticator and challengeAuthenticator take a single options ' +
        'argument and correctly receive no store options.',
      GraderLevel.L4,
    ),
    judge(
      'Does the code branch on whether the user already has a factor — enrolling an authenticator when ' +
        'they have none and challenging an existing one when they do — before verifying? Branching on ' +
        'mfa_requirements from the error cause and branching on the result of listAuthenticators are ' +
        'both acceptable.',
      GraderLevel.L4,
    ),
    judge(
      'For an SMS-enrolled user, does the code challenge the authenticator first to trigger the message ' +
        'and then verify the code the user typed, rather than trying to verify without a challenge?',
      GraderLevel.L4,
    ),
    judge(
      'After successful verification, does the session end up signed in — the tokens from verify stored ' +
        'through the SDK so subsequent requests to /profile and the transfers route work without ' +
        'repeating the MFA flow?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      "Does every MFA operation go through the server client's mfa sub-client (enrollAuthenticator, " +
        'listAuthenticators, challengeAuthenticator, verify) rather than through hand-written fetch calls ' +
        'to Auth0 MFA endpoints or a hand-built MFA grant on the token endpoint? Correct code never ' +
        'writes an Auth0 URL itself.',
      GraderLevel.L5,
    ),
    judge(
      'Is the MFA token read from the error cause as snake_case mfa_token and then passed into the SDK ' +
        'options as camelCase mfaToken? Passing an option key named mfa_token to an SDK method is wrong — ' +
        'the option is mfaToken.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly use the MFA APIs of @auth0/auth0-server-js — detecting mfa_required, ' +
        'lifting the MFA token from the error cause, enrolling or challenging the right factor including ' +
        'SMS, and verifying the submitted code so the session becomes signed in?',
    ),
  ];
}
