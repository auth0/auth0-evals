import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    contains('@auth0/auth0-spa-js', 'Uses @auth0/auth0-spa-js SDK', GraderLevel.L1),
    contains('enterpriseConnect', 'Sets the Enterprise Connect flag on the client', GraderLevel.L1),
    // The SPA family has NO startEnterpriseLogin: the caller does discovery itself.
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
      'Does not invent startEnterpriseLogin — it does not exist in @auth0/auth0-spa-js; use isFederatedDomain + loginWithRedirect',
      GraderLevel.L2,
    ),
    notContainsInSource('@auth0/auth0-react', 'No React wrapper in a plain-JS SPA', GraderLevel.L2),
    notContainsInSource('@auth0/nextjs-auth0', 'No server-side Next.js SDK in a browser SPA', GraderLevel.L2),
    notContainsInSource(
      '/.well-known/webfinger',
      'Does not hand-roll the WebFinger discovery endpoint — isFederatedDomain owns it',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    // EC issues no refresh token; offline_access / useRefreshTokens are stripped
    // and only warned. ignoreComments so an explanatory note is not flagged.
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
      'Does the logout end the enterprise IdP session (federated: true) so a later login cannot silently reuse ' +
        'the previous enterprise user, and does the code treat isFederatedDomain purely as a routing hint (never ' +
        'as an authentication/authorization gate) while NOT pinning a single static organization for every ' +
        'enterprise customer?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project builds (vite build succeeds)', GraderLevel.L4),
    judge(
      'Does the enterprise flow follow the correct SPA shape: (1) the client is created with enterpriseConnect ' +
        'and scope openid profile email (no offline_access); (2) an email-entry form derives the email domain and ' +
        'calls isFederatedDomain; (3) when federated, it calls loginWithRedirect with login_hint set to the email ' +
        '(falling back to the normal login otherwise); (4) logout passes federated: true?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/auth0-spa-js Enterprise Connect surface ' +
        '(the enterpriseConnect flag, isFederatedDomain for discovery, loginWithRedirect with login_hint, and a ' +
        'federated logout) rather than by calling a non-existent startEnterpriseLogin, hand-building /authorize ' +
        'requests, calling the raw WebFinger endpoint, requesting offline_access / refresh tokens, or pinning a ' +
        'fixed organization for every customer?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Enterprise Connect sign-in to a plain-JS SPA using @auth0/auth0-spa-js — ' +
        'the client flagged for Enterprise Connect, an email-driven isFederatedDomain discovery that then calls ' +
        'loginWithRedirect with the email as login_hint to route the user to their enterprise IdP by domain, and a ' +
        'federated logout?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of @auth0/auth0-spa-js (2.x). Unlike the ' +
          'server-side SDKs, the SPA family has NO startEnterpriseLogin method — that symbol does not exist. The ' +
          'correct surface is the enterpriseConnect client flag (warn-only here: it console.warns on ' +
          'useRefreshTokens / offline_access / a static organization but does not throw), the standalone ' +
          'isFederatedDomain(auth0Domain, emailDomain) helper for domain discovery, loginWithRedirect with ' +
          'authorizationParams.login_hint set to the email, and logout with logoutParams.federated: true. Grade ' +
          'the integration, not whether the symbols exist. isFederatedDomain never throws and returns false on any ' +
          'failure, so it is a routing hint, not a security control. Tokens are in-memory and there is no refresh ' +
          'token, so omitting offline_access is correct, not a defect.',
      },
    ),
  ];
}
