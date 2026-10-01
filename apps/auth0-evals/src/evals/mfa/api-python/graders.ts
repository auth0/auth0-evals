import { contains, notContains, notContainsInSource, judge, wroteFile, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required step-up symbols present ──────────────────────────────
    contains('auth0-api-python', 'Uses auth0-api-python SDK', GraderLevel.L1),
    contains(
      'verify_access_token',
      'Validates tokens with the SDK (verify_access_token or verify_request)',
      GraderLevel.L1,
      { source: 'both' },
    ),
    contains('transfer:funds', 'Gates the transfer on the step-up scope transfer:funds', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ───────────────────────────────
    notContains('PyJWT', 'No manual JWT decoding with PyJWT', GraderLevel.L2),
    notContains('python-jose', 'No manual JWT decoding with python-jose', GraderLevel.L2),
    notContains('pyotp', 'No server-side TOTP library (pyotp)', GraderLevel.L2),
    notContains('mfa/challenge', 'Does not call the raw MFA challenge endpoint', GraderLevel.L2),
    notContains('jwt.decode', 'No manual jwt.decode call', GraderLevel.L2),

    // ── L3: Security checks ──────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in source files (ok in .env)', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ──────────────────────────
    compiles('Project compiles (py_compile succeeds)', GraderLevel.L4),
    wroteFile('.env', 'Wrote Auth0 config to .env file', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'api.barkbook.com',
    ]),
    contains('read:balance', 'Existing read:balance scope check on GET /api/balance retained', GraderLevel.L4),
    // Grade the outcome (the transfer is gated on the step-up scope), not the exact call shape — a solution
    // may add a second scope check after write:transfers, combine both in one guard, or use a helper.
    judge(
      'Does POST /api/transfers require the transfer:funds scope so a token that lacks it is rejected with ' +
        'a 403 — while the existing write:transfers requirement is retained — using the SDK ' +
        '(verify_access_token or verify_request) plus a scope string check rather than proceeding with the transfer?',
      GraderLevel.L4,
    ),
    judge(
      'Is the transfer:funds gate applied specifically to POST /api/transfers (not globally or to ' +
        'GET /api/balance), and does read:balance scope enforcement still apply to GET /api/balance?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ─────────────────────────────
    // required_claims=["scope"] only checks that the key "scope" exists in the claims dict —
    // it does NOT verify that "transfer:funds" appears in the space-delimited value.
    // The correct pattern is to split claims["scope"] and check for "transfer:funds" in the list.
    notContains(
      'required_claims',
      'Does not rely on required_claims alone to enforce scope value — required_claims only checks claim key presence, not that transfer:funds is in the space-delimited value',
      GraderLevel.L5,
    ),
    judge(
      'Does the solution enforce scope by splitting the scope claim string (e.g. claims.get("scope", "").split()) ' +
        'and checking for "transfer:funds" in the resulting list, rather than using required_claims=["transfer:funds"] ' +
        '(which only checks key presence) or manually re-validating the JWT?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add step-up enforcement to the Python API using auth0-api-python? ' +
        'POST /api/transfers must be gated on the transfer:funds scope — the scope the tenant issues only ' +
        'after MFA step-up — so a token without it is rejected with a 403, while the existing write:transfers ' +
        'check is retained. GET /api/balance must still require read:balance. Token validation uses ' +
        'verify_access_token or verify_request from auth0-api-python, and issuer/audience come from ' +
        'environment variables — judge only from source code.',
    ),
  ];
}
