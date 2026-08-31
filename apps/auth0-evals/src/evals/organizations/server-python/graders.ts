import { contains, notContains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('organization', 'Passes the organization parameter for org-scoped login', GraderLevel.L1),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1),
    contains('invitation', 'Handles the organization invitation parameter', GraderLevel.L1),
    contains('org_id', 'Reads the org_id claim to identify the logged-in organization', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContains(
      'from auth0 import',
      'No auth0 Management SDK (wrong package — should use auth0-server-python)',
      GraderLevel.L2,
    ),
    notContains('@auth0/organizations', 'No hallucinated JS @auth0/organizations package', GraderLevel.L2),
    notContains('useOrganization(', 'No React hook (wrong ecosystem for Python)', GraderLevel.L2),
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
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded Auth0 client ID in source (allowed only in .env)',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project byte-compiles (compileall succeeds)', GraderLevel.L4),
    contains(
      'dev-barkbook.us.auth0.com',
      'Auth0 config (domain) externalised into the workspace, e.g. .env',
      GraderLevel.L4,
    ),
    matches(
      String.raw`start_interactive_login[\s\S]{0,200}organization`,
      'Organization is wired into the start_interactive_login call (typed field or authorization_params)',
      GraderLevel.L4,
    ),
    judge(
      'Does the code read the "invitation" and "organization" parameters from the URL query string ' +
        'and forward them to start_interactive_login when present — either as the typed StartInteractiveLoginOptions ' +
        'organization/invitation fields or inside authorization_params? ' +
        'To pass, the invitation\'s own "organization" must be forwarded (overriding any default/configured org), ' +
        'and the code must NOT reject or block a valid invitation solely because its organization differs from ' +
        "the app's configured default org.",
      GraderLevel.L4,
    ),
    judge(
      'Does the code surface the organization the user logged into by reading the org_id claim ' +
        'through the SDK (e.g. via get_user() or the complete_interactive_login result) rather than ' +
        'hardcoding or guessing it?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Does the code pass options to start_interactive_login as a StartInteractiveLoginOptions instance ' +
        '(e.g. start_interactive_login(StartInteractiveLoginOptions(organization=...)) or with ' +
        'authorization_params={"organization": ...}), OR configure the default organization on the ServerClient ' +
        'constructor? Passing a raw dict such as start_interactive_login({"authorization_params": {...}}) is a ' +
        'failure — a non-empty dict is not a StartInteractiveLoginOptions and raises AttributeError at runtime.',
      GraderLevel.L5,
    ),
    judge(
      'Does the code read the org_id claim through the SDK session (get_user() or the ' +
        'complete_interactive_login result) rather than manually decoding the raw ID/access token — ' +
        "e.g. splitting the token on '.', base64-decoding a segment, or calling jwt.decode by hand?",
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to a framework-agnostic Python web app ' +
        'using auth0-server-python — logging users into the specified organization (org_barkbook_acme) via ' +
        'start_interactive_login (using the StartInteractiveLoginOptions organization/invitation fields or ' +
        'authorization_params, or a default organization on the ServerClient), accepting organization invitation links via the ' +
        'invitation and organization query parameters, and identifying the logged-in organization from the ' +
        'org_id claim read through the SDK? Rejecting or blocking a valid invitation because its organization ' +
        'differs from the configured default org is a correctness defect, not a cosmetic one — treat it as a ' +
        'failure of invitation acceptance.',
    ),
  ];
}
