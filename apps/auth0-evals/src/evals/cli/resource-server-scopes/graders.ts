import { ranCommand, ranCommandOneOf, ranCommandsInOrder, judge, GraderLevel } from '@a0/evals-graders';

// Goal-only CLI eval run against a live, throwaway tenant the `auth0` CLI is
// already logged into (requested via `provision: auth0-tenant` in PROMPT.md).
// The agent writes no source files, so grading is trace-based plus a trace-aware
// judge. Baseline mode runs no tools, so every grader fails there — agent only.
//
// Registering an API has three parts and agents commonly stop after the first
// two: create the resource server with the right audience, attach the scopes,
// and turn on RBAC (enforce_policies + token_dialect access_token_authz) so the
// permissions are actually enforced and land in the token. A resource server
// with scopes listed but RBAC off is the classic half-done state.
export function defineGraders() {
  return [
    // ── L4: Created the resource server (API) ───────────────────────────────
    ranCommandOneOf(
      ['apis create', 'resource-servers', 'api post resource-servers'],
      'Created the API (resource server) via the Auth0 CLI',
      GraderLevel.L4,
    ),
    // ── L4: Used the correct audience/identifier ────────────────────────────
    ranCommand(
      'api.acme.test/orders',
      undefined,
      'Registered the API with the correct identifier (audience)',
      GraderLevel.L4,
    ),
    // ── L4: Defined the orders scopes ───────────────────────────────────────
    ranCommandOneOf(['read:orders', 'write:orders'], 'Defined the orders scopes', GraderLevel.L4),
    // ── L4: Enabled RBAC enforcement — the step agents skip ─────────────────
    // enforce_policies turns RBAC on; token_dialect access_token_authz puts the
    // granted permissions into the access token.
    ranCommandOneOf(['enforce_policies', 'access_token_authz'], 'Enabled RBAC enforcement for the API', GraderLevel.L4),
    // ── L4: Sequence — the API must exist BEFORE RBAC is enabled on it ──────
    ranCommandsInOrder(
      [
        ['apis create', 'resource-servers', 'api post resource-servers'],
        ['enforce_policies', 'access_token_authz'],
      ],
      'Created the API before enabling RBAC enforcement on it',
      GraderLevel.L4,
    ),

    // ── Holistic judge (no level — always runs) ─────────────────────────────
    // includeCommandTrace: the artifact is the CLI trace, so the judge must see
    // the commands the agent ran.
    judge(
      'Based on the command trace, does the solution register the Orders API via the Auth0 CLI with the ' +
        'identifier https://api.acme.test/orders, define both the read:orders and write:orders scopes, and ' +
        'enable RBAC on the resource server (enforce_policies true) with the permissions included in the access ' +
        'token (token_dialect access_token_authz) — WITHOUT using the dashboard or Terraform, and without ' +
        'leaving RBAC disabled?',
      undefined,
      { includeCommandTrace: true },
    ),
  ];
}
