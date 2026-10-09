import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

// The scaffold ships a /transfers route that reads an Auth0 access token. It is pre-existing and not part of
// the enterprise sign-in path, so no judge should penalise it.
const FIXTURE_CONTEXT =
  'Treat the scaffold pre-existing /transfers access-token route as a fixture: only the new enterprise ' +
  'sign-in path is under test.';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    contains('@auth0/auth0-express', 'Uses @auth0/auth0-express SDK', GraderLevel.L1),
    // Relay mode is a client-level flag; it also makes onCallback mandatory.
    matches(
      String.raw`enterpriseConnect\s*[:=]`,
      'Puts the client into Enterprise Connect relay mode (enterpriseConnect option set)',
      GraderLevel.L1,
    ),
    // The single entry point folds email-domain discovery + the authorize redirect.
    contains(
      'startEnterpriseLogin',
      'Starts enterprise login via the SDK (domain discovery + authorize redirect in one call)',
      GraderLevel.L1,
    ),
    // In relay mode the SDK writes no Auth0 session; onCallback is the only path
    // that can establish the app's own session, and config throws without it.
    contains(
      'onCallback',
      'Supplies an onCallback hook to establish the app session (required when enterpriseConnect is set)',
      GraderLevel.L1,
    ),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContainsInSource('@auth0/auth0-spa-js', 'No browser SPA SDK in a server-side Express app', GraderLevel.L2),
    notContainsInSource('@auth0/nextjs-auth0', 'No Next.js SDK in a bare Express app', GraderLevel.L2),
    notContainsInSource(
      'express-openid-connect',
      'Does not fall back to the legacy express-openid-connect SDK — EC exists only in @auth0/auth0-express',
      GraderLevel.L2,
    ),
    // requiresAuth()/getUser throw in EC mode; using them to gate the enterprise
    // path is the documented wrong approach.
    notContainsInSource(
      'requiresAuth',
      'Does not guard EC routes with requiresAuth() — it calls getUser(), which throws in relay mode',
      GraderLevel.L2,
    ),
    // isFederatedDomain / WebFinger is the SDK helper; hand-rolling the endpoint
    // means the model bypassed the SDK. ignoreComments so a design note is fine.
    notContainsInSource(
      '/.well-known/webfinger',
      'Does not hand-roll the WebFinger discovery endpoint — the SDK owns domain discovery',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    // offline_access / refresh tokens do not exist in relay mode; asking for them
    // is a wrong approach. ignoreComments so an explanatory note is not flagged.
    notContainsInSource(
      'offline_access',
      'Does not request offline_access — Enterprise Connect issues no refresh token',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded Auth0 client secret in source (belongs in the environment)',
      GraderLevel.L3,
    ),
    judge(
      'In the enterprise sign-in path, does the app avoid persisting the Auth0 access token (or any token) from ' +
        'the callback for later use, keeping only identity claims in its own session?',
      GraderLevel.L3,
      { context: FIXTURE_CONTEXT },
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (tsc build succeeds)', GraderLevel.L4),
    // The enterprise login is driven by the user-supplied email.
    matches(
      String.raw`startEnterpriseLogin\s*\([\s\S]{0,200}email`,
      'Calls startEnterpriseLogin with the user-supplied email',
      GraderLevel.L4,
    ),
    judge(
      'Does the enterprise flow follow the correct shape? Check each item and answer yes only if all are met: ' +
        '(1) an email-entry login calls startEnterpriseLogin(req, res, { email }), routing the user to their IdP ' +
        'by email domain and falling back when it returns false for a non-federated domain; (2) the onCallback ' +
        'hook builds the app session from the returned claims and ends the response itself; (3) logout ends the ' +
        'enterprise IdP session (the mounted /auth/logout is federated automatically in EC mode, or an explicit ' +
        'client.logout({ federated: true }) is used)?',
      GraderLevel.L4,
      { context: FIXTURE_CONTEXT },
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/auth0-express Enterprise Connect surface ' +
        '(createAuth0 with the enterpriseConnect option and onCallback hook, startEnterpriseLogin, and the ' +
        'federated mounted logout) rather than by hand-building /authorize or /oauth/token requests, calling the ' +
        'raw WebFinger endpoint, using the legacy express-openid-connect afterCallback hook, gating routes with ' +
        'requiresAuth()/getUser (which throw in relay mode), requesting offline_access, or pinning a fixed ' +
        'organization for every customer?',
      GraderLevel.L5,
      { context: FIXTURE_CONTEXT },
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Enterprise Connect relay login to an Express app using ' +
        '@auth0/auth0-express — the client created with enterpriseConnect and an onCallback hook, an email-driven ' +
        'startEnterpriseLogin that routes users to their enterprise IdP by domain, the app owning its own session ' +
        'created in onCallback, and a federated logout?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of @auth0/auth0-express (1.0.0-beta.4), the ' +
          'successor to express-openid-connect that wraps @auth0/auth0-server-js. The createAuth0 factory, its ' +
          'enterpriseConnect option, the required onCallback hook (EnterpriseConnectCallbackHook), ' +
          'startEnterpriseLogin(req, res, options) returning boolean, isFederatedDomain, and ' +
          'EnterpriseConnectNotSupportedError are all real — grade the integration, not whether the symbols ' +
          'exist. StartEnterpriseLoginOptions is imported from @auth0/auth0-server-js (not re-exported by ' +
          'auth0-express). When enterpriseConnect is set, config throws at startup if onCallback is missing, the ' +
          'SDK writes no Auth0 session (so the onCallback hook must end the response or the handler returns 500 ' +
          'callback_not_resolved), and the mounted /auth/logout is forced federated. getSession, getAccessToken, ' +
          'getUser, and requiresAuth() all throw in relay mode, so the app owning its session and omitting ' +
          'offline_access is correct, not a defect. ' +
          FIXTURE_CONTEXT,
      },
    ),
  ];
}
