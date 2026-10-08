import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required Enterprise Connect symbols present ───────────────────
    contains('@auth0/nextjs-auth0', 'Uses @auth0/nextjs-auth0 SDK', GraderLevel.L1),
    contains('enterpriseConnect', 'Puts the Auth0Client into Enterprise Connect relay mode', GraderLevel.L1),
    contains('startEnterpriseLogin', 'Starts enterprise login via the SDK (server or client helper)', GraderLevel.L1),
    // In relay mode the SDK writes no Auth0 session; onCallback is the only path
    // that can establish the app's own session.
    contains(
      'onCallback',
      'Supplies an onCallback hook to establish the app session (no Auth0 session is written in relay mode)',
      GraderLevel.L1,
    ),
    contains('federated', 'Logout is federated (ends the enterprise IdP session)', GraderLevel.L1),

    // ── L2: Hallucination / wrong approach ────────────────────────────────
    notContainsInSource('@auth0/auth0-spa-js', 'No browser SPA SDK in a Next.js server app', GraderLevel.L2),
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
      'Does the app establish and own its own session in the onCallback hook (returning a NextResponse that sets ' +
        "the app's session) from the returned ID-token claims, rather than relying on an Auth0 session that " +
        'Enterprise Connect never creates or persisting the Auth0 access token for later use?',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    compiles('Project compiles (next build succeeds)', GraderLevel.L4),
    // The enterprise login is driven by the user-supplied email.
    matches(
      String.raw`startEnterpriseLogin\s*\([\s\S]{0,200}email`,
      'Calls startEnterpriseLogin with the user-supplied email',
      GraderLevel.L4,
    ),
    judge(
      'Does the feature wire up the full relay flow: (1) the Auth0Client is created with Enterprise Connect ' +
        'enabled and an onCallback hook; (2) an email-entry login triggers startEnterpriseLogin (server-side ' +
        'returning a NextResponse redirect, or the client helper), routing the user to their IdP by email domain; ' +
        '(3) the onCallback hook builds the app session and returns a NextResponse; (4) logout is federated with ' +
        'an absolute returnTo?',
      GraderLevel.L4,
    ),

    // ── L5: Current API patterns ──────────────────────────────────────────
    judge(
      'Is the enterprise sign-in built on the current @auth0/nextjs-auth0 v4 Enterprise Connect surface ' +
        '(the enterpriseConnect option, startEnterpriseLogin from @auth0/nextjs-auth0/server or the client helper, ' +
        'and the onCallback hook) rather than by hand-building /authorize or token requests, calling getSession in ' +
        'relay mode (which throws), or pinning a fixed organization for every enterprise customer?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly add Enterprise Connect relay login to a Next.js App Router app using ' +
        '@auth0/nextjs-auth0 — the Auth0Client configured for Enterprise Connect with an onCallback hook, an ' +
        'email-driven startEnterpriseLogin that routes users to their enterprise IdP by domain, the app owning its ' +
        'own session created in onCallback, and a federated logout?',
      undefined,
      {
        context:
          'Enterprise Connect is a real, Early-Access feature of @auth0/nextjs-auth0 v4 (4.31.x). ' +
          'Auth0ClientOptions.enterpriseConnect, the server startEnterpriseLogin from @auth0/nextjs-auth0/server ' +
          'returning NextResponse | null, the client startEnterpriseLogin from @auth0/nextjs-auth0 returning ' +
          'boolean, isFederatedDomain, and the onCallback hook are all real — grade the integration, not whether ' +
          'the symbols exist. In relay mode the SDK writes no session and session-dependent methods (getSession, ' +
          'getAccessToken) throw EnterpriseConnectError, so establishing the app session in onCallback and ' +
          'omitting offline_access is correct. A server action cannot return the redirect, so driving ' +
          'startEnterpriseLogin from a Route Handler (and re-emitting the 307 as 303) is the correct shape.',
      },
    ),
  ];
}
