import { contains, notContains, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('organization', 'Passes the organization parameter for org-scoped login', GraderLevel.L1, {
      ignoreComments: true,
    }),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1, {
      ignoreComments: true,
    }),
    contains('invitation', 'Handles the organization invitation parameter', GraderLevel.L1, {
      ignoreComments: true,
    }),
    contains('org_id', 'Reads the org_id claim to identify the logged-in organization', GraderLevel.L1, {
      ignoreComments: true,
    }),
    contains('invitationUrl', 'Uses the invitationUrl authorize option to accept invitation links', GraderLevel.L1, {
      ignoreComments: true,
    }),

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2, {
      ignoreComments: true,
    }),
    notContains(
      'useOrganization(',
      'No non-existent useOrganization hook (react-native-auth0 has no such hook)',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContains('client_secret', 'No client_secret in a public native mobile client', GraderLevel.L2, {
      ignoreComments: true,
    }),

    // ── L3: Security ───────────────────────────────────────────────────────
    judge(
      'Does the code let react-native-auth0 manage credential storage rather than persisting Auth0 tokens by hand?',
      GraderLevel.L3,
      {
        context:
          'Credentials should be handled by the useAuth0 hook / the SDK credentials manager, not persisted by hand in ' +
          'AsyncStorage or another insecure store. Storing application state such as a pending organization id is ' +
          'acceptable — only manual token persistence is a violation.',
      },
    ),

    // ── L4: Structural correctness ─────────────────────────────────────────
    judge(
      'Is org-scoped login performed by passing `organization` to a react-native-auth0 `authorize` call?',
      GraderLevel.L4,
      {
        context:
          'For example, authorize with an organization option set to org_barkbook_acme — via the useAuth0 hook authorize ' +
          'call or the imperative webAuth.authorize — not by hand-appending an organization query parameter to a URL.',
      },
    ),
    judge(
      'Does the code accept an organization invitation by forwarding the inbound invitation URL to the `authorize` call via the `invitationUrl` option?',
      GraderLevel.L4,
      {
        context:
          'Forwarding the URL lets the SDK extract the invitation and organization from it. The invitation must be ' +
          'forwarded as-is; the code must NOT reject or block a valid invitation solely because its organization differs ' +
          "from the app's configured default org.",
      },
    ),
    judge(
      'Does the code surface the organization the user logged into by reading the `org_id` claim from the authenticated user or the returned ID token claims?',
      GraderLevel.L4,
      {
        context:
          'For example the useAuth0 user.org_id, or the org_id claim decoded from the credentials returned by ' +
          'webAuth.authorize — rather than hardcoding or guessing it.',
      },
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    judge(
      'Is org login built with the current react-native-auth0 API rather than a hand-built /authorize URL?',
      GraderLevel.L5,
      {
        context:
          'The current API means the useAuth0 hook authorize call with an organization option, or the imperative ' +
          'webAuth.authorize with organization. Hand-building an /authorize URL or manually decoding the token to read ' +
          'org_id is wrong.',
      },
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the React Native app using react-native-auth0?',
      undefined,
      {
        context:
          'It must log users into org_barkbook_acme by passing organization to authorize, accept organization invitation ' +
          'links via the invitationUrl option, and identify the logged-in organization from the org_id claim on the ' +
          'authenticated user. Rejecting or blocking a valid invitation because its organization differs from the ' +
          'configured default org is a correctness defect, not a cosmetic one — treat it as a failure of invitation ' +
          'acceptance.',
      },
    ),
  ];
}
