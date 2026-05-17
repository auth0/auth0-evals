import { contains, notContains, notContainsInSource, matches, judge, ranCommand, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('auth0-server-python', 'Uses auth0-server-python package', GraderLevel.L1),
    contains('ServerClient', 'Imports ServerClient class', GraderLevel.L1),
    contains('start_interactive_login', 'Uses start_interactive_login method', GraderLevel.L1),
    contains('complete_interactive_login', 'Uses complete_interactive_login method', GraderLevel.L1),
    contains('get_user', 'Uses get_user method to retrieve user info', GraderLevel.L1),
    contains('load_dotenv', 'Loads environment variables with python-dotenv', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('Authlib', 'No Authlib (old approach, not the current SDK)', GraderLevel.L2),
    notContains('python-jose', 'No python-jose (manual JWT parsing not needed)', GraderLevel.L2),
    notContains('Flask-Login', 'No Flask-Login (not needed with auth0-server-python)', GraderLevel.L2),
    notContains('Flask-Dance', 'No Flask-Dance (wrong OAuth package)', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────────────
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
    judge(
      'Are all Auth0 credentials (domain, client ID, client secret, app secret key) ' +
        'stored in environment variables or .env files, not hardcoded in Python source code?',
      undefined,
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    ranCommand('pip install', 'auth0-server-python', 'Ran pip install for auth0-server-python', GraderLevel.L4),
    contains('/callback', 'Implements /callback route', GraderLevel.L4),
    contains('/login', 'Implements /login route', GraderLevel.L4),
    contains('/logout', 'Implements /logout route', GraderLevel.L4),
    contains('/profile', 'Implements /profile route', GraderLevel.L4),
    contains('secret_key', 'Sets Flask app.secret_key for session management', GraderLevel.L4),
    matches(String.raw`async\s+def`, 'Uses async route handlers', GraderLevel.L4),
    judge(
      'Does the app implement login, callback, profile, and logout routes using auth0-server-python, ' +
        'protect the /profile route so it requires login, and include a route that calls an external API ' +
        'using an access token?',
      undefined,
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    contains('authorization_params', 'Uses authorization_params for scope and audience configuration', GraderLevel.L5),
    matches(
      String.raw`audience.*api\.barkbook\.com`,
      "authorization_params contains audience 'https://api.barkbook.com'",
      GraderLevel.L5,
    ),
    judge(
      'Does the solution use current auth0-server-python patterns? ' +
        'Specifically: does it import ServerClient from auth0_server_python, ' +
        'define state and transaction store classes locally (not imported from the SDK), ' +
        'and configure authorization_params with audience and scope?',
      undefined,
      GraderLevel.L5,
    ),

    // ── Holistic judge ────────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a Flask web app using auth0-server-python? ' +
        'It should configure a ServerClient with credentials from env vars, ' +
        'implement login, callback, profile, and logout routes, ' +
        'protect the /profile route so it requires authentication, ' +
        'and use the access token to call an external API with audience https://api.barkbook.com.',
    ),
  ];
}
