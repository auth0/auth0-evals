import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('organization', 'Passes the organization parameter for org-scoped login', GraderLevel.L1),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1),
    contains('invitation', 'Handles the organization invitation parameter', GraderLevel.L1),
    contains('org_id', 'Reads the org_id claim to identify the logged-in organization', GraderLevel.L1),
    contains('.organization(', 'Uses WebAuth .organization for org-scoped login', GraderLevel.L1),
    contains('.invitationURL(', 'Uses WebAuth .invitationURL to accept invitation links', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2),
    notContains('Auth0SDK', 'No hallucinated Auth0SDK package name (correct module is Auth0)', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in a public mobile client', GraderLevel.L2),

    // ── L3: Security ───────────────────────────────────────────────────────
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
      'Does the code let CredentialsManager handle token storage rather than persisting Auth0 tokens ' +
        '(access tokens, ID tokens, refresh tokens) by hand in UserDefaults or the Keychain? Storing ' +
        'application state such as a pending organization is acceptable — only manual token storage is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ─────────────────────────────────────────
    judge(
      'Is org-scoped login performed by chaining .organization("org_barkbook_acme") onto Auth0.webAuth() ' +
        'and starting it, rather than by hand-appending an "organization" query parameter to a URL?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code accept an organization invitation by passing the inbound invitation URL to ' +
        'Auth0.webAuth().invitationURL(...)? To pass, the invitation URL is forwarded as-is (the SDK extracts ' +
        'its organization and invitation parameters), and the code must NOT reject or block a valid invitation ' +
        "solely because its organization differs from the app's configured default org.",
      GraderLevel.L4,
    ),
    judge(
      'Does the code surface the organization the user logged into by reading the org_id claim from the ID token ' +
        '(decoding credentials.idToken with JWTDecode, e.g. decode(jwt:).claim(name: "org_id"), or via ' +
        'UserProfile customClaims), rather than hardcoding or guessing it?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    judge(
      'Is org login built with the current Web Auth builder — Auth0.webAuth() with .organization / ' +
        '.invitationURL — rather than by hand-building an /authorize URL, or by using the Authentication API ' +
        'token methods (login/codeExchange with organization) that are not the Universal Login path this task needs?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the iOS app using Auth0.swift — logging ' +
        'users into org_barkbook_acme via Auth0.webAuth().organization, accepting organization invitation links ' +
        'via .invitationURL, and identifying the logged-in organization from the org_id claim in the ID token? ' +
        'Rejecting or blocking a valid invitation because its organization differs from the configured default ' +
        'org is a correctness defect, not a cosmetic one — treat it as a failure of invitation acceptance.',
    ),
  ];
}
