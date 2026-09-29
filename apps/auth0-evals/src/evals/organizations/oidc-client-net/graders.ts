import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

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

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated JS @auth0/organizations package', GraderLevel.L2, {
      ignoreComments: true,
    }),
    notContains(
      'Auth0ClaimNames',
      'No use of the internal Auth0ClaimNames class — read the "org_id" claim string directly',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContains(
      'JwtSecurityTokenHandler',
      'No manual JWT decoding — read claims from LoginResult.User, not by decoding the token',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ───────────────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded Auth0 domain in .cs source (allowed only in appsettings.json)',
      GraderLevel.L3,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in .cs source (allowed only in appsettings.json)',
      GraderLevel.L3,
      { ignoreComments: true },
    ),
    notContains('client_secret', 'No client_secret in a public native client', GraderLevel.L3, {
      ignoreComments: true,
    }),

    // ── L4: Structural correctness ─────────────────────────────────────────
    judge(
      'Is org-scoped login performed by passing `organization` to `LoginAsync` as a lowercase key on the anonymous extra-parameters object?',
      GraderLevel.L4,
      {
        context:
          'For example LoginAsync with a new object whose organization field is org_barkbook_acme — not by hand-appending ' +
          'an organization query parameter to a URL or setting a non-existent property on Auth0ClientOptions.',
      },
    ),
    judge(
      'Does the code accept an organization invitation by passing the `invitation` value alongside `organization` on the `LoginAsync` extra-parameters object?',
      GraderLevel.L4,
      {
        context:
          'The invitation must be forwarded; the code must NOT reject or block a valid invitation solely because its ' +
          "organization differs from the app's configured default org.",
      },
    ),
    judge(
      'Does the code surface the organization the user logged into by reading the `org_id` claim from the login result principal?',
      GraderLevel.L4,
      {
        context:
          'For example loginResult.User.FindFirst with the claim type "org_id" — rather than hardcoding or guessing it.',
      },
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    judge(
      'Are `organization` and `invitation` passed as lowercase anonymous-object properties to `LoginAsync`, and is `org_id` read from the login result principal?',
      GraderLevel.L5,
      {
        context:
          'org_id should be read from the ClaimsPrincipal on the login result rather than by manually decoding the token ' +
          'or using the internal Auth0ClaimNames class.',
      },
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the .NET desktop app using auth0-oidc-client-net?',
      undefined,
      {
        context:
          'It must log users into org_barkbook_acme by passing organization to LoginAsync, accept organization invitation ' +
          'links via the invitation parameter, and identify the logged-in organization from the org_id claim read off the ' +
          'login result principal. Rejecting or blocking a valid invitation because its organization differs from the ' +
          'configured default org is a correctness defect, not a cosmetic one — treat it as a failure of invitation ' +
          'acceptance.',
      },
    ),
  ];
}
