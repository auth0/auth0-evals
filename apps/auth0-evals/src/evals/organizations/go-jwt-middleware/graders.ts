import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1, {
      ignoreComments: true,
    }),
    // org_id is exposed on ValidatedClaims.RegisteredClaims.OrgID — the agent must read that field.
    contains('OrgID', 'Reads the OrgID registered claim off the validated claims', GraderLevel.L1, {
      ignoreComments: true,
    }),

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContains(
      'WithExpectedOrgID',
      'No invented WithExpectedOrgID option (does not exist in go-jwt-middleware)',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContains(
      'golang-jwt',
      'No manual JWT parsing with golang-jwt — read claims through the middleware',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContains('go-jwt-middleware/v2', 'No go-jwt-middleware v2 import — the current major is v3', GraderLevel.L2, {
      ignoreComments: true,
    }),

    // ── L3: Security ───────────────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in .go source (allowed in .env)',
      GraderLevel.L3,
      { ignoreComments: true },
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in .go source (allowed in .env)', GraderLevel.L3, {
      ignoreComments: true,
    }),

    // ── L4: Structural / behavioral correctness ───────────────────────────
    judge(
      'Does `GET /api/org/members` reject a request whose validated token has a missing or mismatched `org_id`?',
      GraderLevel.L4,
      {
        context:
          'The route should restrict access to org_barkbook_acme by checking the validated token org_id. This may be done ' +
          'inside the validator (a WithRegisteredClaimsValidator function or a CustomClaims Validate method) or in the ' +
          'route handler after validation by reading OrgID (for example via GetClaims on the request context) and ' +
          'returning a 4xx (401/403) on a missing or mismatched org_id. Enforcing the Acme org globally on the validator ' +
          '(which would also block non-Acme callers on other routes) is not required — per-route handler enforcement is ' +
          'correct. The target org id may come from an environment variable — treat an env-sourced org id as correctly wired.',
      },
    ),
    judge(
      'Does `GET /api/org/profile` return the caller org_id read from the validated token claims?',
      GraderLevel.L4,
      {
        context:
          'It should read org_id from the validated claims — for example the OrgID field on RegisteredClaims obtained via ' +
          'GetClaims on the request context — while the route stays behind the JWT middleware, rather than hardcoding the ' +
          'organization.',
      },
    ),

    // ── L5: Version-specific API correctness ───────────────────────────────
    notContains('ContextKey{}', 'No v2-style ContextKey{} claim lookup — use the v3 GetClaims helper', GraderLevel.L5, {
      ignoreComments: true,
    }),
    judge(
      'Does the solution read and enforce the organization through go-jwt-middleware v3 rather than parsing the token by hand?',
      GraderLevel.L5,
      {
        context:
          'Current go-jwt-middleware v3 builds the validator with option functions (such as WithValidator), reads claims ' +
          'with GetClaims on the request context, and reads org_id from RegisteredClaims.OrgID rather than from an untyped ' +
          'map. Enforcement may live in the validator (WithRegisteredClaimsValidator or a CustomClaims Validate method) or ' +
          'in the route handler after validation — both are current-API correct. Hand-parsing the token (golang-jwt) or a ' +
          'v2-style ContextKey{} lookup is wrong.',
      },
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the Go API using go-jwt-middleware?',
      undefined,
      {
        context:
          'GET /api/org/members must be restricted to org_barkbook_acme by checking the validated token org_id (a missing ' +
          'or mismatched org_id must yield a 4xx or 401/403 response), and GET /api/org/profile must return the caller ' +
          'org_id read from the validated RegisteredClaims. The target organization id may be supplied via an environment ' +
          'variable — treat an env-sourced org id as correctly wired, not a defect.',
      },
    ),
  ];
}
