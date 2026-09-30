import { contains, notContains, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('org_id', 'References the org_id claim from the validated token', GraderLevel.L1, {
      ignoreComments: true,
    }),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1, {
      ignoreComments: true,
    }),
    // Enforcement runs through verify_access_token - either its required_claims presence check
    // or a subsequent value comparison against the target org.
    contains(
      'verify_access_token',
      'Enforces org membership on the token validated by verify_access_token',
      GraderLevel.L1,
      { ignoreComments: true },
    ),

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContains('jwt.decode', 'No manual PyJWT decoding - read claims from verify_access_token', GraderLevel.L2, {
      ignoreComments: true,
    }),
    notContains(
      'from auth0 import',
      'No auth0-python management SDK (wrong package for token validation)',
      GraderLevel.L2,
      {
        ignoreComments: true,
      },
    ),
    notContains(
      'auth0_server_python',
      'No auth0-server-python web SDK - this is a resource-server API',
      GraderLevel.L2,
      {
        ignoreComments: true,
      },
    ),

    // ── L3: Security ───────────────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in .py source (allowed in .env)',
      GraderLevel.L3,
      { ignoreComments: true },
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in .py source (allowed in .env)', GraderLevel.L3, {
      ignoreComments: true,
    }),

    // ── L4: Structural / behavioral correctness ───────────────────────────
    compiles('Project byte-compiles (compileall succeeds)', GraderLevel.L4),
    judge(
      'Does `GET /api/org/members` reject a request whose validated token has a missing or non-matching `org_id`?',
      GraderLevel.L4,
      {
        context:
          'The route should validate the access token with verify_access_token and require org_id to equal ' +
          'org_barkbook_acme — either by passing required_claims=["org_id"] and comparing claims["org_id"], or by ' +
          'comparing the claim directly. A token whose org_id is missing or different should be rejected with a 4xx ' +
          '(401/403) rather than served. The target org id may come from an environment variable — treat an env-sourced ' +
          'org id as correctly wired.',
      },
    ),
    judge(
      'Does `GET /api/org/profile` return the `org_id` read from the claims returned by `verify_access_token` while still validating the token?',
      GraderLevel.L4,
      {
        context:
          'For example claims["org_id"] from the dict returned by verify_access_token — rather than hardcoding the ' +
          'organization.',
      },
    ),

    // ── L5: Version-specific API correctness ───────────────────────────────
    judge(
      "Does the solution validate the token and read claims only through auth0-api-python's verify_access_token, rather than hand-decoding the JWT?",
      GraderLevel.L5,
      {
        context:
          'Current auth0-api-python validates the token via the ApiClient.verify_access_token method and reads claims from ' +
          'the dict it returns. Hand-decoding the JWT (PyJWT jwt.decode, base64-decoding a token segment) or inventing an ' +
          'org-specific SDK option is wrong. Judge only from the source code; the domain, audience, and target org id may ' +
          'be supplied via environment variables — treat an env-sourced org id as correctly wired.',
      },
    ),

    // ── Holistic judge (no level - always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the Python API using auth0-api-python?',
      undefined,
      {
        context:
          'GET /api/org/members must validate the access token with verify_access_token and be restricted to ' +
          'org_barkbook_acme by checking the org_id claim (a missing or mismatched org_id must yield a 4xx or 401/403 ' +
          'response), and GET /api/org/profile must return the caller org_id read from the validated claims. The target ' +
          'organization id may be supplied via an environment variable — treat an env-sourced org id as correctly wired, ' +
          'not a defect.',
      },
    ),
  ];
}
