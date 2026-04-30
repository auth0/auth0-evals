import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  ranCommand,
  wroteFile,
  GraderLevel,
} from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('auth0-fastapi-api', 'Uses auth0-fastapi-api package', GraderLevel.L1),
    contains('Auth0FastAPI', 'Imports Auth0FastAPI class', GraderLevel.L1),
    contains('require_auth', 'Uses require_auth() dependency', GraderLevel.L1),
    contains('Depends', 'Uses FastAPI Depends for dependency injection', GraderLevel.L1),
    contains('domain', 'Configures domain', GraderLevel.L1),
    contains('audience', 'Configures audience', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('python-jose', 'No python-jose (manual JWT parsing not needed)', GraderLevel.L2),
    notContains('PyJWT', 'No PyJWT direct usage', GraderLevel.L2),
    notContains('jwt.decode', 'No manual JWT decoding', GraderLevel.L2),
    notContains('fastapi-users', 'No fastapi-users (wrong package for Auth0 JWT)', GraderLevel.L2),
    notContains('passlib', 'No passlib (unrelated auth package)', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded Auth0 domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in source files (ok in .env)', GraderLevel.L3),
    judge(
      'Are the Auth0 domain and audience stored in environment variables or a .env file, not hardcoded in Python source code?',
      undefined,
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    ranCommand('pip install', 'auth0-fastapi-api', 'Ran pip install for auth0-fastapi-api', GraderLevel.L4),
    wroteFile('.env', 'Created .env file for credentials', GraderLevel.L4),
    matches(String.raw`Auth0FastAPI\s*\(`, 'Auth0FastAPI instance is created', GraderLevel.L4),
    matches(
      String.raw`Depends\s*\(\s*\w+\.require_auth\s*\(`,
      'Route protected with Depends(auth0.require_auth())',
      GraderLevel.L4,
    ),
    contains('read:messages', 'read:messages scope checked on /api/messages route', GraderLevel.L4),
    judge(
      'Does the app correctly create an Auth0FastAPI instance, protect /api/messages with the read:messages scope, ' +
        'and protect /api/private requiring any valid access token?',
      undefined,
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    judge(
      'Does the solution use current auth0-fastapi-api patterns? ' +
        'Specifically: does it use Auth0FastAPI with domain and audience parameters, ' +
        'use require_auth() as a FastAPI Depends dependency (not a decorator), ' +
        'and read credentials from environment variables (not hardcoded)?',
      undefined,
      GraderLevel.L5,
    ),

    // ── Holistic judge ────────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a FastAPI API using auth0-fastapi-api? ' +
        'It should create an Auth0FastAPI instance configured with domain and audience from environment variables, ' +
        'protect the /api/messages route with read:messages scope check, ' +
        'and protect the /api/private route requiring a valid access token.',
    ),
  ];
}
