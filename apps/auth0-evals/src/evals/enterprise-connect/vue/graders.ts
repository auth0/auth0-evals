import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    contains('@auth0/auth0-vue', 'Uses @auth0/auth0-vue SDK', GraderLevel.L1),
    contains('enterpriseConnect', 'Sets the Enterprise Connect flag in createAuth0', GraderLevel.L1),
    // The SPA family has NO startEnterpriseLogin: the caller does discovery itself
    // via the standalone isFederatedDomain function re-exported from the package.
    contains('isFederatedDomain', 'Uses the SDK isFederatedDomain helper for email-domain discovery', GraderLevel.L1),
    // Login routes to the enterprise IdP by passing the email as login_hint.
    contains('login_hint', 'Passes the user email as login_hint to route to the enterprise IdP', GraderLevel.L1),
    // Logout must terminate the federated IdP session, not just the local one.
    matches(String.raw`federated\s*:\s*true`, 'Logout is federated (ends the enterprise IdP session)', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    // startEnterpriseLogin does NOT exist in the SPA SDKs. The Confluence design
    // doc wrongly claims it does; inventing it is the signature hallucination.
    notContainsInSource(
      'startEnterpriseLogin',
      'Does not invent startEnterpriseLogin — it does not exist in @auth0/auth0-vue; use isFederatedDomain + loginWithRedirect',
      GraderLevel.L2,
    ),
    notContainsInSource(
      '@auth0/auth0-spa-js',
      'Uses the Vue wrapper, not the raw @auth0/auth0-spa-js SDK',
      GraderLevel.L2,
    ),
    notContainsInSource('@auth0/nextjs-auth0', 'No server-side Next.js SDK in a browser SPA', GraderLevel.L2),
    notContainsInSource(
      '/.well-known/webfinger',
      'Does not hand-roll the WebFinger discovery endpoint — isFederatedDomain owns it',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'offline_access',
      'Does not request offline_access — Enterprise Connect issues no refresh token',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'useRefreshTokens',
      'Does not enable refresh tokens — Enterprise Connect issues none',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    judge(
      'Is the enterprise IdP session ended on EVERY logout path (each logout call passes federated: true' +
        ', including any rejection or org-mismatch logout, if the app has one), so a later login cannot silently reuse the previous enterprise user?',
      GraderLevel.L3,
    ),
    judge(
      'Does the code treat isFederatedDomain purely as a routing hint (never as an authentication/authorization ' +
        'gate) while NOT pinning a single static organization for every enterprise customer?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project builds (vite build succeeds)', GraderLevel.L4),
    judge(
      'Does the enterprise flow follow the correct Vue shape? Check each item and answer yes only if all are met: ' +
        '(1) createAuth0 sets enterpriseConnect; (2) an email-entry form derives the email domain and calls the ' +
        'standalone isFederatedDomain; (3) when federated it calls useAuth0().loginWithRedirect with ' +
        'authorizationParams.login_hint set to the email, falling back to the normal login otherwise; (4) ' +
        'useAuth0().logout passes federated: true?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/auth0-vue Enterprise Connect surface ' +
        '(the enterpriseConnect option on createAuth0, the standalone isFederatedDomain function, ' +
        'useAuth0().loginWithRedirect with login_hint, and a federated useAuth0().logout) rather than by calling ' +
        'a non-existent startEnterpriseLogin, dropping to the raw spa-js client, hand-building /authorize ' +
        'requests, requesting offline_access, or pinning a fixed organization for every customer?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Enterprise Connect sign-in to a Vue app using @auth0/auth0-vue — the ' +
        'client flagged for Enterprise Connect, an email-driven isFederatedDomain discovery that then calls ' +
        'useAuth0().loginWithRedirect with the email as login_hint to route the user to their enterprise IdP by ' +
        'domain, and a federated logout on every path?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of @auth0/auth0-vue (2.x). Unlike the server-side ' +
          'SDKs, the SPA family has NO startEnterpriseLogin method — that symbol does not exist. The correct ' +
          'surface is the enterpriseConnect option on createAuth0 (inherited on Auth0VueClientOptions), the ' +
          'standalone isFederatedDomain(auth0Domain, emailDomain) function re-exported from the package, ' +
          'useAuth0().loginWithRedirect with authorizationParams.login_hint, and useAuth0().logout with ' +
          'logoutParams.federated: true. Grade the integration, not whether the symbols exist. isFederatedDomain ' +
          'never throws and returns false on any failure, so it is a routing hint, not a security control. Tokens ' +
          'are in-memory and there is no refresh token, so omitting offline_access is correct, not a defect.',
      },
    ),
  ];
}
