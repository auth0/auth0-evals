import { contains, notContains, notContainsInSource, judge, wroteFile, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required step-up symbols present ──────────────────────────────
    contains('Auth0.AspNetCore.Authentication.Api', 'Uses the Auth0 ASP.NET Core API SDK', GraderLevel.L1),
    contains(
      'HasScopeRequirement',
      'Enforces the scope with the HasScopeRequirement authorization policy',
      GraderLevel.L1,
    ),
    contains('transfer:funds', 'Gates the transfer on the step-up scope transfer:funds', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ───────────────────────────────
    // The real API SDK is Auth0.AspNetCore.Authentication.Api; the web-app SDK
    // Auth0.AspNetCore.Authentication (its using has no trailing .Api) is for
    // MVC/Blazor server apps and is the wrong tool here.
    notContains(
      'AddAuth0WebAppAuthentication',
      'Does not use the web-app SDK (AddAuth0WebAppAuthentication)',
      GraderLevel.L2,
    ),
    notContains('Auth0.AspNetCore.Api', 'No hallucinated Auth0.AspNetCore.Api package', GraderLevel.L2),
    notContains(
      'System.IdentityModel.Tokens.Jwt',
      'No manual JWT decoding with JwtSecurityTokenHandler',
      GraderLevel.L2,
    ),
    notContains('JwtSecurityTokenHandler', 'No manual JWT decoding with JwtSecurityTokenHandler', GraderLevel.L2),

    // ── L3: Security checks ──────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in source files (ok in appsettings.json)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'api.barkbook.com',
      'No hardcoded audience in source files (ok in appsettings.json)',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ──────────────────────────
    wroteFile('appsettings.json', 'Wrote Auth0 config to appsettings.json', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'api.barkbook.com',
    ]),
    contains('write:transfers', 'Existing write:transfers scope check retained', GraderLevel.L4),
    contains('read:balance', 'Existing read:balance scope check on GET /api/balance retained', GraderLevel.L4),
    // Grade the outcome (the transfer is gated on the step-up scope), not the exact call shape — a solution
    // may add a second RequireAuthorization policy, register a combined policy that demands both scopes, or
    // apply an [Authorize] attribute keyed to a transfer:funds policy.
    judge(
      'Does POST /api/transfers require the transfer:funds scope so a token that lacks it is rejected with ' +
        '403 — while the existing write:transfers requirement is retained — enforced through the ' +
        'authorization policy / HasScopeRequirement mechanism rather than by proceeding with the transfer?',
      GraderLevel.L4,
    ),
    judge(
      'Is the transfer:funds gate applied specifically to POST /api/transfers (not globally or to ' +
        'GET /api/balance), and does read:balance scope enforcement still apply to GET /api/balance?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ─────────────────────────────
    // The current pattern is AddAuth0ApiAuthentication + a scope-based
    // authorization policy (HasScopeRequirement/HasScopeHandler reading the space-
    // delimited scope claim). Hand-decoding the token or manually splitting the
    // scope string in the endpoint is the deprecated path.
    judge(
      'Does the solution enforce the scope through the ASP.NET Core authorization pipeline — an ' +
        'authorization policy backed by HasScopeRequirement/HasScopeHandler (or RequireClaim on the scope ' +
        'claim) — rather than manually splitting the space-delimited scope string or hand-decoding the ' +
        'access token inside the endpoint?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add step-up enforcement to the ASP.NET Core API using ' +
        'Auth0.AspNetCore.Authentication.Api? POST /api/transfers must be gated on the transfer:funds ' +
        'scope — the scope the tenant issues only after MFA step-up — so a token without it is rejected with ' +
        'a 403, while the existing write:transfers check is retained. GET /api/balance must still require ' +
        'read:balance. The scope is enforced through an authorization policy, and the domain and audience ' +
        'come from the Auth0 section of appsettings.json — judge only from source code.',
    ),
  ];
}
