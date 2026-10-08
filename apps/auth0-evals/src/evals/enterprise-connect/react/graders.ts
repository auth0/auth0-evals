import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    contains('@auth0/auth0-react', 'Uses @auth0/auth0-react SDK', GraderLevel.L1),
    contains('enterpriseConnect', 'Sets the Enterprise Connect flag on Auth0Provider', GraderLevel.L1),
    // react is the one SPA SDK with sugar: the useEnterpriseConnect hook exposes
    // isFederatedDomain + loginWithSSO (which wraps loginWithRedirect/login_hint).
    contains('useEnterpriseConnect', 'Uses the useEnterpriseConnect hook for discovery + SSO login', GraderLevel.L1),
    contains('loginWithSSO', 'Starts enterprise login via loginWithSSO(email)', GraderLevel.L1),
    // Logout must terminate the federated IdP session, not just the local one.
    matches(String.raw`federated\s*:\s*true`, 'Logout is federated (ends the enterprise IdP session)', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    // startEnterpriseLogin does NOT exist in the SPA SDKs. The Confluence design
    // doc wrongly claims it does; inventing it is the signature hallucination.
    notContainsInSource(
      'startEnterpriseLogin',
      'Does not invent startEnterpriseLogin — it does not exist in @auth0/auth0-react; use useEnterpriseConnect',
      GraderLevel.L2,
    ),
    // Reach through the react wrapper, not past it into the raw browser SDK.
    notContainsInSource(
      '@auth0/auth0-spa-js',
      'Uses the React wrapper, not the raw @auth0/auth0-spa-js SDK',
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
      'Does the logout end the enterprise IdP session (federated: true) so a later login cannot silently reuse ' +
        'the previous enterprise user, and does the code treat isFederatedDomain (from useEnterpriseConnect) ' +
        'purely as a routing hint (never as an authentication/authorization gate) while NOT pinning a single ' +
        'static organization for every enterprise customer?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project builds (vite build succeeds)', GraderLevel.L4),
    judge(
      'Does the enterprise flow follow the correct React shape: (1) Auth0Provider is configured with ' +
        'enterpriseConnect and scope openid profile email (no offline_access); (2) an email-entry form uses ' +
        'useEnterpriseConnect() to call isFederatedDomain(emailDomain); (3) when federated it calls ' +
        'loginWithSSO(email) (falling back to the normal loginWithRedirect otherwise); (4) logout passes ' +
        'federated: true?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/auth0-react Enterprise Connect surface ' +
        '(the enterpriseConnect prop and the useEnterpriseConnect hook — isFederatedDomain + loginWithSSO — with ' +
        'a federated logout) rather than by calling a non-existent startEnterpriseLogin, dropping to the raw ' +
        'spa-js client, hand-building /authorize requests, requesting offline_access / refresh tokens, or pinning ' +
        'a fixed organization for every customer?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Enterprise Connect sign-in to a React app using @auth0/auth0-react — ' +
        'Auth0Provider flagged for Enterprise Connect, an email-driven useEnterpriseConnect().isFederatedDomain ' +
        'discovery that then calls loginWithSSO(email) to route the user to their enterprise IdP by domain, and a ' +
        'federated logout?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of @auth0/auth0-react (2.x). Unlike the server-side ' +
          'SDKs, the SPA family has NO startEnterpriseLogin method — that symbol does not exist. The correct ' +
          'surface is the enterpriseConnect prop on Auth0Provider and the useEnterpriseConnect() hook, which ' +
          'returns isFederatedDomain(emailDomain) (reads the tenant domain from provider config, so the caller ' +
          'passes only the email domain) and loginWithSSO(email) (wraps loginWithRedirect with login_hint). ' +
          'Logout uses useAuth0().logout with logoutParams.federated: true. Grade the integration, not whether ' +
          'the symbols exist. isFederatedDomain never throws and returns false on any failure, so it is a routing ' +
          'hint, not a security control. Tokens are in-memory and there is no refresh token, so omitting ' +
          'offline_access is correct, not a defect.',
      },
    ),
  ];
}
