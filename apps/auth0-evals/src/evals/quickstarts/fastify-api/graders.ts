import { contains, notContains, notContainsInSource, matches, judge, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('@auth0/auth0-fastify-api', 'Uses @auth0/auth0-fastify-api package', GraderLevel.L1),
    contains('fastifyAuth0Api', 'Imports fastifyAuth0Api plugin', GraderLevel.L1),
    contains('requireAuth', 'Uses fastify.requireAuth() to protect routes', GraderLevel.L1),
    contains('preHandler', 'Uses preHandler to attach auth middleware', GraderLevel.L1),
    contains('domain', 'Configures domain', GraderLevel.L1),
    contains('audience', 'Configures audience', GraderLevel.L1),

    // ── L2: Negative / anti-pattern detection ─────────────────────────────────
    notContains('express-oauth2-jwt-bearer', 'No express-oauth2-jwt-bearer (wrong SDK for Fastify)', GraderLevel.L2),
    notContains('passport', 'No passport middleware (not needed with @auth0/auth0-fastify-api)', GraderLevel.L2),
    notContains('jsonwebtoken', 'No jsonwebtoken (manual JWT verification not needed)', GraderLevel.L2),
    notContains('jwt.verify', 'No manual jwt.verify() calls', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────────────
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded Auth0 domain in source files (ok in .env)',
      GraderLevel.L3,
    ),
    notContainsInSource('api.barkbook.com', 'No hardcoded audience in source files (ok in .env)', GraderLevel.L3),
    judge(
      'Are the Auth0 domain and audience stored in environment variables or a .env file, not hardcoded in source code?',
      undefined,
      GraderLevel.L3,
    ),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    matches(
      String.raw`fastify\.register\s*\(\s*fastifyAuth0Api`,
      'Auth0 API plugin registered with fastify.register()',
      GraderLevel.L4,
    ),
    matches(
      String.raw`preHandler\s*:\s*fastify\.requireAuth\s*\(`,
      'Route protected with preHandler: fastify.requireAuth()',
      GraderLevel.L4,
    ),
    contains('read:messages', 'read:messages scope checked on /api/messages route', GraderLevel.L4),
    judge(
      'Does the app correctly register the @auth0/auth0-fastify-api plugin, protect /api/messages with the read:messages scope, ' +
        'and protect /api/private requiring any valid access token?',
      undefined,
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    judge(
      'Does the solution use current @auth0/auth0-fastify-api patterns? ' +
        'Specifically: does it register the plugin via fastify.register(), ' +
        'use preHandler: fastify.requireAuth() for route protection (not a decorator), ' +
        'access token claims via request.user, ' +
        'and read credentials from environment variables (not hardcoded)?',
      undefined,
      GraderLevel.L5,
    ),

    // ── Holistic judge ────────────────────────────────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a Fastify API using @auth0/auth0-fastify-api? ' +
        'It should register the plugin with domain and audience from environment variables, ' +
        'protect the /api/messages route using fastify.requireAuth() with read:messages scope (as string or array) check using preHandler, ' +
        'and protect the /api/private route using fastify.requireAuth() requiring any valid access token.',
    ),
  ];
}
