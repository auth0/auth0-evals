import { contains, notContains, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('organization', 'Passes the organization parameter for org-scoped login', GraderLevel.L1),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1),
    contains('invitation', 'Handles the organization invitation parameter', GraderLevel.L1),
    // In @auth0/nextjs-auth0 v4, org_id is automatically on session.user — no JWT decode needed.
    contains('session.user.org_id', 'Reads org_id from the server-side session', GraderLevel.L1),
    contains(
      'authorizationParameters',
      'Uses v4 authorizationParameters key (not v3 authorizationParams)',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2),
    // AUTH0_ORGANIZATION does not exist in this SDK at any version.
    notContains('AUTH0_ORGANIZATION', 'No non-existent AUTH0_ORGANIZATION env var', GraderLevel.L2),
    notContains('useOrganization(', 'No non-existent useOrganization hook (not a Next.js server API)', GraderLevel.L2),
    notContains(
      'loginWithRedirect',
      'Does not use React SPA loginWithRedirect in a server-side Next.js app',
      GraderLevel.L2,
    ),
    notContains(
      'getIdTokenClaims',
      'Does not use SPA getIdTokenClaims — org_id is read via server session',
      GraderLevel.L2,
    ),

    // ── L3: Security ───────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded Auth0 domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    judge(
      'Does the code avoid exposing Auth0 tokens or the org_id claim to the browser — for example, ' +
        'not returning them from Server Components as props passed to Client Components, not embedding ' +
        'them in client state, and not sending them in a JSON response to the client?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ─────────────────────────────────────────
    compiles('Project compiles (build succeeds)', GraderLevel.L4),
    judge(
      'Is org-scoped login configured by passing organization inside authorizationParameters — either in ' +
        'the Auth0Client constructor (new Auth0Client({ authorizationParameters: { organization: "org_barkbook_acme" } })) ' +
        'or as a login URL query parameter (/auth/login?organization=org_barkbook_acme) — rather than by ' +
        'hand-building an /authorize URL or setting a non-existent top-level organization option?',
      GraderLevel.L4,
    ),
    judge(
      'Does the code handle organization invitation links by directing users to the /auth/login route ' +
        'with the invitation and organization query parameters forwarded? The @auth0/nextjs-auth0 v4 ' +
        'middleware (middleware.ts or proxy.ts — both are valid in Next.js 16) forwards these parameters ' +
        'automatically to /authorize — no manual extraction is needed. The code must NOT reject or block ' +
        "a valid invitation solely because its organization differs from the app's configured default org.",
      GraderLevel.L4,
    ),
    judge(
      'Does the code surface the logged-in organization by reading session.user.org_id server-side ' +
        '(via auth0.getSession() in a Server Component, Server Action, or Route Handler), rather than ' +
        'hardcoding or guessing the org, or attempting to decode the raw ID token manually?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    notContains('handleAuth', 'Does not use v3 handleAuth (v4 uses middleware)', GraderLevel.L5),
    notContains('/api/auth/', 'Does not use v3 route prefix /api/auth/ (v4 uses /auth/)', GraderLevel.L5),
    notContains('AUTH0_ISSUER_BASE_URL', 'Does not use removed v3 env var AUTH0_ISSUER_BASE_URL', GraderLevel.L5),
    judge(
      'Does the solution use the v4 Auth0Client from @auth0/nextjs-auth0/server with ' +
        'authorizationParameters.organization (the full key name, not the v3 shorthand authorizationParams), ' +
        'and avoid the v3 patterns handleAuth, withPageAuthRequired, or /api/auth/ routes?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the Next.js App Router app using ' +
        '@auth0/nextjs-auth0 v4 — configuring org-scoped login with authorizationParameters.organization, ' +
        'accepting organization invitation links via the /auth/login route (middleware.ts or proxy.ts are ' +
        'both valid in Next.js 16), and reading the logged-in organization from session.user.org_id ' +
        'server-side? Rejecting or blocking a valid invitation because its organization differs from the ' +
        'configured default org is a correctness defect, not a cosmetic one — treat it as a failure of invitation acceptance.',
    ),
  ];
}
