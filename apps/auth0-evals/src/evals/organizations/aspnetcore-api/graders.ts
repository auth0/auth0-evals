import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('org_id', 'References the org_id claim from the validated token', GraderLevel.L1, {
      ignoreComments: true,
    }),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1, {
      ignoreComments: true,
    }),
    // Org enforcement is a framework-level authorization policy on the org_id claim.
    contains('RequireClaim', 'Enforces org membership with a RequireClaim authorization policy', GraderLevel.L1, {
      ignoreComments: true,
    }),

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContains(
      'JwtSecurityTokenHandler',
      'No manual JWT decoding — read claims from the validated ClaimsPrincipal',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContains(
      'AddAuth0WebAppAuthentication',
      'No web-app SDK (AddAuth0WebAppAuthentication) — this is a resource-server API',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContains(
      'AddAuth0Authentication',
      'No web-app AddAuth0Authentication — the API SDK uses AddAuth0ApiAuthentication',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ───────────────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in .cs source (allowed only in appsettings.json)',
      GraderLevel.L3,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'api.barkbook.com',
      'No hardcoded audience in .cs source (allowed only in appsettings.json)',
      GraderLevel.L3,
      { ignoreComments: true },
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────
    judge(
      'Does `GET /api/org/members` reject a request whose validated token has a missing or mismatched `org_id`?',
      GraderLevel.L4,
      {
        context:
          'Access should be restricted to org_barkbook_acme with an authorization policy that requires the org_id claim to ' +
          'equal org_barkbook_acme — for example an AddAuthorization policy built with RequireClaim("org_id", ' +
          '"org_barkbook_acme") applied to the endpoint via RequireAuthorization("<policy>") or an [Authorize(Policy = ' +
          '"<policy>")] attribute. A rejected request returns a 401 or 403 rather than being served.',
      },
    ),
    judge(
      'Does `GET /api/org/profile` return the `org_id` read from the authenticated principal while the route stays behind authorization?',
      GraderLevel.L4,
      {
        context: 'For example ctx.User.FindFirst("org_id")?.Value — rather than hardcoding the organization.',
      },
    ),

    // ── L5: Version-specific API correctness ───────────────────────────────
    judge(
      'Does the solution enforce the organization with a standard ASP.NET Core authorization policy on the `org_id` claim rather than a bespoke JwtBearer pipeline or hand-decoding the token?',
      GraderLevel.L5,
      {
        context:
          'It should keep the current Auth0.AspNetCore.Authentication.Api setup (AddAuth0ApiAuthentication bound to the ' +
          'Auth0 configuration section) and enforce the organization with a RequireClaim policy on org_id, reading the ' +
          'claim off the ClaimsPrincipal — not adding a bespoke AddJwtBearer stack or decoding the token by hand with ' +
          'JwtSecurityTokenHandler. The target org id may be supplied via configuration; treat a config-sourced org id as ' +
          'correctly wired.',
      },
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the ASP.NET Core API using Auth0.AspNetCore.Authentication.Api?',
      undefined,
      {
        context:
          'GET /api/org/members must be restricted to org_barkbook_acme with a RequireClaim("org_id", ...) authorization ' +
          'policy (a missing or mismatched org_id must yield a 401 or 403), and GET /api/org/profile must return the ' +
          'caller org_id read from the validated ClaimsPrincipal. The target organization id may be supplied via ' +
          'configuration — treat a config-sourced org id as correctly wired, not a defect.',
      },
    ),
  ];
}
