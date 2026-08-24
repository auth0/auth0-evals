import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  compiles,
  GraderLevel,
} from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────────────────────────
    contains('acr_values', 'Step-up login request uses the acr_values parameter', GraderLevel.L1),
    contains('amr', 'AMR claim checked to detect prior MFA completion', GraderLevel.L1),
    contains(
      'schemas.openid.net/pape/policies/2007/06/multi-factor',
      'Uses the correct multi-factor acr_values policy URI',
      GraderLevel.L1,
    ),
    contains(
      'start_interactive_login',
      'Triggers step-up via the SDK start_interactive_login method',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains('pyotp', 'No server-side TOTP library (pyotp) — Auth0 performs the MFA', GraderLevel.L2),
    notContains('otplib', 'No JS TOTP library (otplib) — wrong ecosystem for this SDK', GraderLevel.L2),
    notContains(
      'mfa/challenge',
      'Does not hand-roll the raw /mfa/challenge endpoint (wrong approach for a redirect web app)',
      GraderLevel.L2,
    ),
    notContains('jwt.decode', 'No manual JWT decoding — read claims through the SDK, not by hand', GraderLevel.L2),

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
      String.raw`start_interactive_login\s*\([\s\S]*?acr_values`,
      'Step-up authorization params are passed into start_interactive_login',
      GraderLevel.L4,
    ),
    judge(
      'Does the code check the amr claim from the authenticated user (via the SDK — e.g. ' +
        'get_user()/get_session() or the complete_interactive_login result) and only run the funds ' +
        'transfer when "mfa" is present in amr, otherwise sending the user into step-up login first?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the code pass acr_values inside the authorization_params dict given to ' +
        'start_interactive_login (e.g. start_interactive_login({"authorization_params": {...}})) ' +
        'rather than as a top-level keyword argument?',
      GraderLevel.L5,
    ),
    notContains(
      'id_token.split',
      'Reads the amr claim through the SDK session (get_user()/complete_interactive_login), ' +
        'not by manually splitting/decoding the raw ID token',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement MFA step-up in a framework-agnostic Python web app using ' +
        'auth0-server-python — inspecting the amr claim to detect prior MFA, requesting step-up via ' +
        'start_interactive_login with acr_values set to the multi-factor policy URI when MFA is absent, ' +
        'and gating the Transfer Funds action behind MFA verification?',
    ),
  ];
}
