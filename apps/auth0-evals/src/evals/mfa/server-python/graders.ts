import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('MfaRequiredError', 'Detects the mfa_required signal via MfaRequiredError', GraderLevel.L1),
    contains('mfa_token', 'Reads the MFA token off the error', GraderLevel.L1),
    contains('list_authenticators', 'Lists enrolled authenticators', GraderLevel.L1),
    contains('challenge_authenticator', 'Challenges an enrolled authenticator', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('pyotp', 'No server-side TOTP library (pyotp) — Auth0 performs the MFA', GraderLevel.L2),
    notContains('otplib', 'No JS TOTP library (otplib) — wrong ecosystem for this SDK', GraderLevel.L2),
    notContains(
      'mfa/challenge',
      'Does not hand-roll the raw /mfa/challenge endpoint — use the SDK mfa client',
      GraderLevel.L2,
    ),
    notContains('jwt.decode', 'No manual JWT decoding — read claims through the SDK, not by hand', GraderLevel.L2),
    notContains(
      'base64.b64decode',
      'No manual base64 JWT segment decoding — read claims through the SDK, not by hand',
      GraderLevel.L2,
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded Auth0 client secret in source (allowed only in .env)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code avoid exposing raw Auth0 tokens (access, ID, or refresh tokens) in HTTP ' +
        'responses or logs, relying on the SDK-managed encrypted session rather than persisting ' +
        'tokens itself?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project byte-compiles (compileall succeeds)', GraderLevel.L4),
    // Content-based (not event-based): confirms the provided Auth0 config was
    // externalised into the workspace (conventionally .env). A `contains` check
    // is robust to how the agent wrote the file — a runner that writes via a
    // shell heredoc (`printf ... > .env`) instead of the write_file tool would
    // slip past an event-based wroteFile grader.
    contains(
      'dev-barkbook.us.auth0.com',
      'Auth0 config (domain) externalised into the workspace, e.g. .env',
      GraderLevel.L4,
    ),
    matches(
      String.raw`verify\s*\([^)]*mfa_token`,
      'Completes MFA through mfa.verify with the mfa_token from the error',
      GraderLevel.L4,
    ),
    judge(
      'Does the code catch MfaRequiredError from the token request, read the mfa_token off the error, ' +
        'and drive the MFA API flow (list_authenticators, then challenge_authenticator and verify) ' +
        'before allowing the funds transfer to proceed?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'For a user with no enrolled factor, does the code branch on the result of list_authenticators ' +
        '(or the mfa_requirements on the error) — enrolling an authenticator when there is none and ' +
        'challenging an existing one when there is — before calling verify?',
      GraderLevel.L5,
    ),
    judge(
      'Does the code persist the session after a successful mfa.verify (e.g. verify(..., persist=True) ' +
        'or the SDK equivalent) so subsequent requests stay authenticated without repeating the MFA ' +
        'flow, rather than manually decoding the raw token — e.g. base64-decoding a segment or calling ' +
        'jwt.decode by hand?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA API sign-in in a framework-agnostic Python web app ' +
        'using auth0-server-python — detecting mfa_required via MfaRequiredError and reading the ' +
        'mfa_token off the error, listing then challenging or enrolling the right factor, and finishing ' +
        'through mfa.verify (persisting the session) so the Transfer Funds action is gated behind MFA?',
    ),
  ];
}
