import { contains, notContains, notContainsInSource, judge, wroteFile, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required step-up symbols present ──────────────────────────────
    contains('transfer:funds', 'Gates the transfer on the step-up scope transfer:funds', GraderLevel.L1),
    contains('oauth2ResourceServer', 'Validates tokens as an OAuth2 resource server', GraderLevel.L1),
    // Spring maps the space-delimited scope claim to SCOPE_-prefixed authorities.
    contains('SCOPE_transfer:funds', 'Requires the SCOPE_-prefixed transfer:funds authority', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ───────────────────────────────
    // auth0-spring-security-api is the unmaintained legacy library; its
    // JwtWebSecurityConfigurer / WebSecurityConfigurerAdapter were removed in
    // Spring Security 6.
    notContains(
      'auth0-spring-security-api',
      'Does not use the deprecated auth0-spring-security-api library',
      GraderLevel.L2,
    ),
    notContains('JwtWebSecurityConfigurer', 'Does not use the removed JwtWebSecurityConfigurer', GraderLevel.L2),
    notContains(
      'WebSecurityConfigurerAdapter',
      'Does not use the removed WebSecurityConfigurerAdapter',
      GraderLevel.L2,
    ),
    notContains('io.jsonwebtoken', 'No manual JWT parsing with jjwt', GraderLevel.L2),
    notContains('com.auth0.jwt', 'No manual JWT parsing with java-jwt', GraderLevel.L2),

    // ── L3: Security checks ──────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded issuer domain in source files (ok in application.yml)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'api.barkbook.com',
      'No hardcoded audience in source files (ok in application.yml)',
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ──────────────────────────
    wroteFile('application.yml', 'Wrote Auth0 issuer and audience to application.yml', GraderLevel.L4, [
      'dev-barkbook.us.auth0.com',
      'api.barkbook.com',
    ]),
    contains('SCOPE_write:transfers', 'Existing write:transfers scope check retained', GraderLevel.L4),
    contains('SCOPE_read:balance', 'Existing read:balance scope check on GET /api/balance retained', GraderLevel.L4),
    // Grade the outcome (the transfer is gated on the step-up scope), not the exact call shape — a solution
    // may combine both authorities with access(...)/a custom AuthorizationManager, use @PreAuthorize with
    // an "and" expression, or add hasAuthority for the new scope alongside the existing check.
    judge(
      'Does POST /api/transfers require the SCOPE_transfer:funds authority so a token that lacks the ' +
        'transfer:funds scope is rejected with 403 — while the existing SCOPE_write:transfers requirement is ' +
        'retained — enforced through Spring Security authorization rather than by proceeding with the transfer?',
      GraderLevel.L4,
    ),
    judge(
      'Is the transfer:funds gate applied specifically to POST /api/transfers (not globally or to ' +
        'GET /api/balance), and does the read:balance authority still gate GET /api/balance?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ─────────────────────────────
    // The current pattern is a SecurityFilterChain bean with oauth2ResourceServer(jwt)
    // and SCOPE_-prefixed authorities. hasRole (ROLE_ prefix) or hand-splitting the
    // scope claim in the controller is the wrong path.
    judge(
      'Does the solution enforce the scope through Spring Security authorities on the resource server — ' +
        'hasAuthority("SCOPE_transfer:funds") or @PreAuthorize/access with the SCOPE_ authority — rather ' +
        'than hasRole, manually splitting the scope claim in the controller, or hand-decoding the JWT?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add step-up enforcement to the Spring Boot resource-server API? ' +
        'POST /api/transfers must be gated on the transfer:funds scope — the scope the tenant issues only ' +
        'after MFA step-up — via the SCOPE_transfer:funds authority, so a token without it is rejected with ' +
        'a 403, while the existing write:transfers check is retained. GET /api/balance must still require ' +
        'read:balance. The issuer and audience come from application.yml — judge only from source code.',
    ),
  ];
}
