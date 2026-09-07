import { contains, notContains, notContainsInSource, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Organizations symbols present ─────────────────────────
    contains('organization', 'Passes the organization parameter for org-scoped login', GraderLevel.L1),
    contains('org_barkbook_acme', 'Wires the specific Acme org (org_barkbook_acme)', GraderLevel.L1),
    contains('invitation', 'Handles the organization invitation parameter', GraderLevel.L1),
    contains('org_id', 'Reads the org_id claim to identify the logged-in organization', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK ──────────────────────────────────────
    notContains('@auth0/organizations', 'No hallucinated @auth0/organizations package', GraderLevel.L2),
    notContains(
      'useOrganization(',
      'No non-existent useOrganization hook (express-openid-connect is not hook-based)',
      GraderLevel.L2,
    ),
    notContains('@auth0/auth0-react', 'No React SDK in an Express web app', GraderLevel.L2),
    notContains('@auth0/nextjs-auth0', 'No Next.js SDK in an Express web app', GraderLevel.L2),
    notContains(
      'express-oauth2-jwt-bearer',
      'No express-oauth2-jwt-bearer (that is the API/bearer-token SDK, not the web-app OIDC SDK)',
      GraderLevel.L2,
    ),
    notContains(
      'passport',
      'No passport — the app uses express-openid-connect, not Passport strategies',
      GraderLevel.L2,
    ),

    // ── L3: Security ───────────────────────────────────────────────────────
    // The scaffold already reads issuer/client/secret from AUTH0_* env vars, so
    // these must never be hardcoded into source (allowed in a local .env).
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in source files (ok in .env)', GraderLevel.L3),

    // ── L4: Structural correctness ─────────────────────────────────────────
    compiles('Project compiles (node --check succeeds)', GraderLevel.L4),
    // Org-scoped login in express-openid-connect is only possible by attaching
    // `organization` to an authorizationParams object. A textual regex can't tell
    // real wiring from a property READ, a comment, a string literal, a wrong-cased
    // identifier, or a value nested one object deeper — and the matches executor is
    // case-insensitive by default. Use a source-aware judge that reads the code
    // instead of pattern-matching raw text.
    judge(
      'Does the code perform org-scoped login by passing the organization VALUE into an ' +
        'authorizationParams object — i.e. as a key inside `authorizationParams: { organization: ... }` ' +
        '(on the auth() config or res.oidc.login), or by assigning `authorizationParams.organization = ...` ' +
        'before calling res.oidc.login? To pass, `organization` must be an actual value SENT to Auth0 in the ' +
        'authorize request. Answer NO if `organization` appears only as a top-level config key (a sibling of ' +
        'authorizationParams, not inside it), only inside a comment or string literal, or is merely READ from ' +
        'user/claims (e.g. logging req.oidc.user.org_id) without being passed into authorizationParams.',
      GraderLevel.L4,
    ),
    judge(
      'Does the code read the "invitation" and "organization" parameters from the request URL query ' +
        'string and forward them (inside authorizationParams) to res.oidc.login when present — typically by ' +
        'disabling the default login route (routes.login = false) and defining a custom /login handler? ' +
        'To pass, the invitation\'s own "organization" must be forwarded (overriding any default/configured ' +
        'org), and the code must NOT reject or block a valid invitation solely because its organization ' +
        "differs from the app's configured default org.",
      GraderLevel.L4,
    ),
    judge(
      'Does the code surface the organization the user logged into by reading the org_id claim from the ' +
        'session/ID token (e.g. req.oidc.user.org_id or req.oidc.idTokenClaims.org_id), rather than ' +
        'hardcoding or guessing it? Validating org_id in an afterCallback hook (decoding session.id_token ' +
        'and checking claims.org_id) is an acceptable, good-practice way to satisfy this.',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ───────────────────────────────────────────
    judge(
      'Does the code pass the organization value inside an authorizationParams object (on the auth() ' +
        'config or on res.oidc.login) rather than as a top-level "organization" config key or a positional ' +
        'argument? Also confirm it uses current express-openid-connect APIs (auth(), requiresAuth(), ' +
        'res.oidc.login, req.oidc) and not removed/deprecated options such as httpAgent or top-level ' +
        'audience/scope keys.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ────────────────────────────
    judge(
      'Does the solution correctly add Auth0 Organizations support to the Express web app using ' +
        'express-openid-connect — logging users into the specified organization (org_barkbook_acme) via ' +
        'organization inside authorizationParams, accepting organization invitation links via the invitation ' +
        'and organization query parameters, and identifying the logged-in organization from the org_id claim ' +
        '(req.oidc.user.org_id / req.oidc.idTokenClaims)? Enforcing or validating org membership via an ' +
        'afterCallback org_id check, or via the claimEquals/claimCheck/claimIncludes route helpers, is ' +
        'good practice and must not be marked wrong. Rejecting or blocking a valid invitation because its ' +
        'organization differs from the configured default org is a correctness defect, not a cosmetic one — ' +
        'treat it as a failure of invitation acceptance. The issuer, client ID and secret come from AUTH0_* ' +
        'environment variables — judge only from the source code and do not assume the contents of any .env file.',
    ),
  ];
}
