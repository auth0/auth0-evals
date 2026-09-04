import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('organization', 'Passes the organization parameter for org-scoped login', GraderLevel.L1),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1),
    contains('invitation', 'Handles the organization invitation parameter', GraderLevel.L1),
    contains('org_id', 'Reads the org_id claim to identify the logged-in organization', GraderLevel.L1),
    contains('withOrganization', 'Uses WebAuthProvider.withOrganization for org-scoped login', GraderLevel.L1),
    contains('withInvitationUrl', 'Uses WebAuthProvider.withInvitationUrl to accept invitation links', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2),
    notContains('auth0-java', 'No auth0-java (server-side SDK, not for Android)', GraderLevel.L2),
    // Auth0.Android has no dedicated org accessor on Credentials; a useOrganization
    // hook belongs to the React SDK, not the Android builder API.
    notContains('useOrganization(', 'No non-existent useOrganization hook (not an Android API)', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in a public mobile client', GraderLevel.L2),

    // ── L3: Security ───────────────────────────────────────────────────────
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
        'persisting Auth0 tokens (access tokens, ID tokens, refresh tokens) by hand in plain SharedPreferences? ' +
        'Storing application state such as a pending organization is acceptable — only manual token storage is a violation.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ─────────────────────────────────────────
    judge(
      'Is org-scoped login performed by chaining .withOrganization("org_barkbook_acme") onto ' +
        'WebAuthProvider.login(account) and starting it, rather than by hand-appending an "organization" ' +
        'query parameter to a URL?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code accept an organization invitation by passing the inbound invitation URL to ' +
        'WebAuthProvider.login(account).withInvitationUrl(...)? To pass, the invitation URL is forwarded as-is ' +
        '(the SDK extracts its organization and invitation parameters), and the code must NOT reject or block a ' +
        "valid invitation solely because its organization differs from the app's configured default org.",
      GraderLevel.L4,
    ),
    judge(
      'Does the code surface the organization the user logged into by reading the org_id claim from the ID token ' +
        '(decoding credentials.idToken via the com.auth0.android:jwtdecode library, or reading it from ' +
        'credentials.user.getExtraInfo()), rather than hardcoding or guessing it?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    judge(
      'Is the request built with the current builder API — WebAuthProvider.login(account) with ' +
        '.withOrganization / .withInvitationUrl — rather than by hand-building an /authorize URL or using the ' +
        'removed WebAuthProvider.init entry point?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the Android app using Auth0.Android — ' +
        'logging users into org_barkbook_acme via WebAuthProvider.withOrganization, accepting organization ' +
        'invitation links via withInvitationUrl, and identifying the logged-in organization from the org_id claim ' +
        'in the ID token? Rejecting or blocking a valid invitation because its organization differs from the ' +
        'configured default org is a correctness defect, not a cosmetic one — treat it as a failure of invitation acceptance.',
    ),
  ];
}
