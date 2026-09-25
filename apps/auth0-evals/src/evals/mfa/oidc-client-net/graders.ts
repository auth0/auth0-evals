import { contains, notContains, notContainsInSource, judge, wroteFile, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required step-up symbols present ──────────────────────────────
    contains('LoginAsync', 'Triggers step-up through the SDK LoginAsync method', GraderLevel.L1),
    // Auth0 step-up is requested by passing acr_values through the login parameters.
    contains('acr_values', 'Requests MFA step-up via the acr_values authorization parameter', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ───────────────────────────────
    // There is no dedicated MFA method on the OIDC client — step-up is driven by
    // authorization parameters, not a fabricated helper.
    notContains('LoginWithMfaAsync', 'No fabricated LoginWithMfaAsync method', GraderLevel.L2),
    notContains('RequestMfaAsync', 'No fabricated RequestMfaAsync method', GraderLevel.L2),
    notContains('Auth0.OidcClient.Mfa', 'No hallucinated Auth0.OidcClient.Mfa package', GraderLevel.L2),
    // The raw IdentityModel client and the ASP.NET web-app SDK are the wrong tools
    // for a native desktop app.
    notContains('IdentityModel.OidcClient', 'Does not drop down to the raw IdentityModel OidcClient', GraderLevel.L2),
    notContains('Auth0.AspNetCore.Authentication', 'Does not use the ASP.NET web-app SDK', GraderLevel.L2),

    // ── L3: Security checks ──────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in source files (ok in appsettings.json)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in appsettings.json)',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ──────────────────────────
    wroteFile('appsettings.json', 'Wrote Auth0 config to appsettings.json', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'barkbook_client_abc123xyz',
      'https://api.barkbook.com',
    ]),
    // Grade the outcome: step-up is requested and the result is checked before transferring.
    judge(
      'On the Transfer Funds action, does the code call LoginAsync passing acr_values (through the ' +
        'extraParameters object) to request MFA step-up before the transfer proceeds, rather than reusing ' +
        'the existing session or fabricating an MFA-specific method?',
      GraderLevel.L4,
    ),
    judge(
      'After step-up, does the code confirm MFA actually happened — by inspecting the acr or amr claim on ' +
        'the returned LoginResult.User (ClaimsPrincipal) — and only perform the transfer when MFA is ' +
        'confirmed, treating a missing/insufficient claim as a failure?',
      GraderLevel.L4,
    ),
    judge(
      'Is the regular Login button flow left intact (a plain LoginAsync without the step-up acr_values), ' +
        'with the step-up applied only to the Transfer Funds action?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ─────────────────────────────
    // Extra authorization parameters are passed as an anonymous object to
    // LoginAsync; claims are read off LoginResult.User. Hand-building the
    // /authorize URL or reading a non-existent property is the wrong path.
    judge(
      'Does the code pass acr_values as part of the extraParameters object argument to LoginAsync (the ' +
        'current API), and read the acr/amr claim off LoginResult.User, rather than hand-building an ' +
        '/authorize URL or using named/positional acr_values arguments that do not exist on LoginAsync?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add MFA step-up to the Transfer Funds action of the .NET desktop app ' +
        'using Auth0.OidcClient? It must call LoginAsync with acr_values (via the extraParameters object) to ' +
        'force MFA step-up, then confirm MFA occurred by reading the acr/amr claim off LoginResult.User ' +
        'before performing the transfer, while leaving the ordinary Login flow untouched. Domain, client ID ' +
        'and audience come from appsettings.json — judge only from source code.',
    ),
  ];
}
