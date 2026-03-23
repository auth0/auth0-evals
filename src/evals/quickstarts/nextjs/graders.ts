import { contains, notContains, matches, judge } from '../../../agent_eval/graders.js';

export function defineGraders() {
  return [
    // Positive: correct SDK and patterns
    contains('@auth0/nextjs-auth0'),
    contains('handleAuth'),
    contains('getSession'),
    matches('AUTH0_SECRET'),
    matches('AUTH0_BASE_URL'),
    matches('AUTH0_ISSUER_BASE_URL'),
    matches('AUTH0_CLIENT_ID'),
    matches('AUTH0_CLIENT_SECRET'),
    contains('UserProvider'),

    // Negative: hallucinated packages and dangerous patterns
    notContains('@auth0/nextjs-sdk', 'No hallucinated @auth0/nextjs-sdk package'),
    notContains('@auth0/auth0-react', 'Does not use SPA SDK in server app'),
    notContains('barkbook_secret_def456uvw', 'No hardcoded client secret in source files'),

    judge(
      'Does the solution correctly integrate Auth0 into a Next.js App Router app ' +
        'using handleAuth route handler, getSession, and UserProvider?',
      'nextjs',
    ),
  ];
}
