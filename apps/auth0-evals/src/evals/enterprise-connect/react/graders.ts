import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

const SPA_SURFACE_CONTEXT =
  'Enterprise Connect is a real, Early-Access feature of @auth0/auth0-react. Relay mode is enabled by the enterpriseConnect prop on Auth0Provider — a ' +
  'plain boolean config flag; there is no separate Enterprise Connect client or factory. useEnterpriseConnect() returns isFederatedDomain(emailDomain) and loginWithSSO(email). ' +
  'Federated logout is logout({ logoutParams: { federated: true, returnTo } }) — federated inside ' +
  'logoutParams is the correct v2 shape, not a defect. Grade the integration, not whether the symbols exist.';

// Barkbook already has its own password sign-in; the task puts Enterprise Connect in front of it.
const FIXTURE_CONTEXT =
  'The scaffold is Barkbook, a single-page app with its own email + password sign-in that did not use ' +
  'Auth0 before: the /signin view signs users in against the app API (signInWithPassword / ' +
  'fetchCurrentUser / signOut in src/api.js), ?email= pre-fills it, and /dashboard loads ' +
  'fetchCurrentUser() and sends signed-out users to /signin. The SDK was installed but not wired. The ' +
  'task adds Enterprise Connect with ONE Auth0 client configured with the B2B Connect integration ' +
  'domain and client ID (a public client: no client secret). Expected: an email-first step checks ' +
  'isFederatedDomain; a federated email starts the Auth0 redirect with the email as login_hint, and a ' +
  'non-federated email continues to the existing /signin password sign-in with the email pre-filled, ' +
  'not to loginWithRedirect / Auth0 Universal Login. An enterprise user comes back signed in through ' +
  'the SDK (tokens in memory), so /dashboard must accept a user authenticated through the SDK ' +
  '(useAuth0() isAuthenticated / user) as well as a password user from fetchCurrentUser. The email step ' +
  'may live on /signin itself or on a separate view. Federated logout must return to /signin, the ' +
  'registered Allowed Logout URL; password users may keep using signOut(). Validating org_id is ' +
  'optional.';

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
      'Is the enterprise IdP session ended on EVERY logout path (each logout call passes federated: true' +
        '), so a later login cannot silently reuse the previous enterprise user?',
      GraderLevel.L3,
      { context: SPA_SURFACE_CONTEXT },
    ),
    judge(
      'Does the code treat isFederatedDomain purely as a routing hint (never as an authentication/authorization ' +
        'gate) while NOT pinning a single static organization for every enterprise customer?',
      GraderLevel.L3,
      { context: SPA_SURFACE_CONTEXT },
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project builds (vite build succeeds)', GraderLevel.L4),
    judge(
      'Does the enterprise flow follow the correct React shape? Check each item and answer yes only if all are ' +
        'met: (1) Auth0Provider is configured with enterpriseConnect; (2) an email-entry form uses ' +
        'useEnterpriseConnect() to call isFederatedDomain(emailDomain); (3) when federated it calls ' +
        'loginWithSSO(email), falling back to the existing /signin password sign-in otherwise; (4) logout passes ' +
        'federated: true?',
      GraderLevel.L4,
      { context: SPA_SURFACE_CONTEXT + ' ' + FIXTURE_CONTEXT },
    ),

    // /signin is the only registered Allowed Logout URL.
    matches(
      String.raw`returnTo[\s\S]{0,120}/signin`,
      'Federated logout returns to the registered /signin URL',
      GraderLevel.L4,
    ),
    judge(
      'Is the enterprise sign-in integrated with the existing app rather than replacing it? Check each item ' +
        'and answer yes only if all are met: (1) a non-federated email continues to the existing /signin ' +
        'password sign-in with the email pre-filled, not to loginWithRedirect / Universal Login; (2) the ' +
        'existing password sign-in (signInWithPassword) still works; (3) /dashboard accepts an enterprise ' +
        'user authenticated through the SDK as well as a password user; (4) a single Auth0 client is ' +
        'configured from the B2B Connect integration domain and client ID; (5) the federated logout returns ' +
        'to /signin?',
      GraderLevel.L4,
      { context: SPA_SURFACE_CONTEXT + ' ' + FIXTURE_CONTEXT },
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/auth0-react Enterprise Connect surface ' +
        '(the enterpriseConnect prop and the useEnterpriseConnect hook — isFederatedDomain + loginWithSSO — with ' +
        'a federated logout) rather than by calling a non-existent startEnterpriseLogin, dropping to the raw ' +
        'spa-js client, hand-building /authorize requests, requesting offline_access / refresh tokens, or pinning ' +
        'a fixed organization for every customer?',
      GraderLevel.L5,
      { context: SPA_SURFACE_CONTEXT },
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Enterprise Connect sign-in to a React app using @auth0/auth0-react — ' +
        'Auth0Provider flagged for Enterprise Connect, an email-driven useEnterpriseConnect().isFederatedDomain ' +
        'discovery that then calls loginWithSSO(email) to route the user to their enterprise IdP by domain, a fallback to the ' +
        'existing /signin password sign-in for non-federated emails, and a federated logout?',
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
          'offline_access is correct, not a defect. ' +
          FIXTURE_CONTEXT,
      },
    ),
  ];
}
