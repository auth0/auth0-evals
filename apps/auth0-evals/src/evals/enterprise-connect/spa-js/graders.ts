import { notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

const SPA_SURFACE_CONTEXT =
  'Enterprise Connect is a real, Early-Access feature of @auth0/auth0-spa-js. It is switched on by the enterpriseConnect option on createAuth0Client — a ' +
  'plain boolean flag that is routing/telemetry only: it does not change the login flow, and the SDK just warns on contradictory config (useRefreshTokens, offline_access, a static organization, or a logout without federated: true). There is no separate Enterprise Connect client or factory. isFederatedDomain(auth0Domain, emailDomain) is a standalone export, not a client method. ' +
  'Federated logout is logout({ logoutParams: { federated: true, returnTo } }) — federated inside ' +
  'logoutParams is the correct v2 shape, not a defect. isFederatedDomain is async (Promise<boolean>), so its result must be awaited; it never throws and returns false on any failure, so it is a routing hint, not a security control. Enterprise Connect issues no refresh token. Grade the integration, not whether the symbols exist.';

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
  'the SDK (tokens in memory), so /dashboard must accept a user authenticated through the SDK (the ' +
  'client isAuthenticated() / getUser()) as well as a password user from fetchCurrentUser. The email ' +
  'step may live on /signin itself or on a separate view. Federated logout must return to /signin, the ' +
  'registered Allowed Logout URL; password users may keep using signOut(). Validating org_id is ' +
  'optional.';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    matches(
      String.raw`(?:from\s*|import\s*|require\s*\(\s*)['"]@auth0/auth0-spa-js(?:/[\w.-]+)*['"]`,
      'Uses @auth0/auth0-spa-js SDK',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    matches(
      String.raw`enterpriseConnect\s*:\s*true`,
      'Sets the Enterprise Connect flag on the client',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    // The SPA family has NO startEnterpriseLogin: the caller does discovery itself.
    matches(
      String.raw`\bisFederatedDomain\s*\(|\bisFederatedDomain\b[\s\S]*\bisFederatedDomain\b`,
      'Uses the SDK isFederatedDomain helper for email-domain discovery',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    // Login routes to the enterprise IdP by passing the email as login_hint.
    matches(
      String.raw`['"]?\blogin_hint['"]?\s*:`,
      'Passes the user email as login_hint to route to the enterprise IdP',
      GraderLevel.L1,
      { caseSensitive: true },
    ),
    // Logout must terminate the federated IdP session, not just the local one.
    matches(String.raw`federated\s*:\s*true`, 'Logout is federated (ends the enterprise IdP session)', GraderLevel.L1, {
      caseSensitive: true,
    }),

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

    notContainsInSource(
      '/oauth/token',
      'Does not hand-roll token exchange — the SDK performs the Enterprise Connect code exchange',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/authorize?',
      'Does not hand-build the /authorize URL — the SDK builds it (login_hint / relay params)',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'organization:',
      'Does not pin a fixed organization — Enterprise Connect routes by the email domain',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'auth0-js',
      'Does not use the legacy auth0-js SDK — it has no Enterprise Connect support',
      GraderLevel.L2,
    ),
    notContainsInSource(
      '.isFederatedDomain(',
      'isFederatedDomain is a standalone function, not a method on the client/service/composable',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    notContainsInSource(
      'refreshToken',
      'Does not read or store a refresh token — Enterprise Connect issues none',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'refresh_token',
      'Does not use a refresh_token grant or field — Enterprise Connect issues none',
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
    // One judge per outcome so a failure names itself. What a regex already checks (the flag,
    // federated: true, returnTo /signin, signInWithPassword) is not asked again.
    judge(
      'Is loginWithRedirect called with authorizationParams.login_hint set to the email the user typed, and only ' +
        "after the awaited isFederatedDomain(auth0Domain, emailDomain) resolved true for that email's domain?",
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
      'Does a non-federated email continue to the existing /signin password sign-in with the email pre-filled, ' +
        'rather than to loginWithRedirect / Auth0 Universal Login or a new password form?',
      GraderLevel.L4,
      { context: SPA_SURFACE_CONTEXT + ' ' + FIXTURE_CONTEXT },
    ),
    judge(
      'Does an enterprise user coming back from Auth0 reach /dashboard signed in? Answer yes only if both hold: ' +
        '(1) /dashboard accepts a user authenticated through the SDK (isAuthenticated() / getUser()) as well as a ' +
        'password user from fetchCurrentUser; (2) after handleRedirectCallback the app renders /dashboard in the ' +
        'same page load or navigates client-side (a full page load such as window.location.assign or setting ' +
        'location.href clears the in-memory SDK session, so the user would be sent back to /signin).',
      GraderLevel.L4,
      { context: SPA_SURFACE_CONTEXT + ' ' + FIXTURE_CONTEXT },
    ),
    judge(
      'Is exactly one Auth0 client configured, from the B2B Connect integration domain and client ID?',
      GraderLevel.L4,
      { context: SPA_SURFACE_CONTEXT + ' ' + FIXTURE_CONTEXT },
    ),

    // ── Existing password sign-in still works (non-federated path is untouched) ──
    matches(
      String.raw`(?:await\s+|\.)signInWithPassword\s*\(`,
      'Existing password sign-in (signInWithPassword) is still called from the sign-in view',
      GraderLevel.L4,
      { caseSensitive: true },
    ),
    matches(
      String.raw`get\(\s*['"]email['"]\s*\)`,
      'Sign-in view still pre-fills the email from ?email=',
      GraderLevel.L4,
      { caseSensitive: true },
    ),
    matches(String.raw`pathname\s*===\s*['"]/signin['"]`, 'The /signin route is still registered', GraderLevel.L4, {
      caseSensitive: true,
    }),
    matches(
      String.raw`(?:await\s+|=\s*)fetchCurrentUser\s*\(|fetchCurrentUser\s*\(\s*\)\s*\.then`,
      'Dashboard still loads the password-session user via fetchCurrentUser',
      GraderLevel.L4,
      { caseSensitive: true },
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/auth0-spa-js Enterprise Connect surface ' +
        '(the enterpriseConnect flag, isFederatedDomain for discovery, loginWithRedirect with login_hint, and a ' +
        'federated logout) rather than by calling a non-existent startEnterpriseLogin, hand-building /authorize ' +
        'requests, calling the raw WebFinger endpoint, requesting offline_access / refresh tokens, or pinning a ' +
        'fixed organization for every customer?',
      GraderLevel.L5,
      { context: SPA_SURFACE_CONTEXT },
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Enterprise Connect sign-in to a plain-JS SPA using @auth0/auth0-spa-js — ' +
        'the client flagged for Enterprise Connect, an email-driven isFederatedDomain discovery that then calls ' +
        'loginWithRedirect with the email as login_hint to route the user to their enterprise IdP by domain, a fallback to the ' +
        'existing /signin password sign-in for non-federated emails, and a federated logout?',
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
          'token, so omitting offline_access is correct, not a defect. ' +
          FIXTURE_CONTEXT,
      },
    ),
  ];
}
