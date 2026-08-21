import { auth0 } from './lib/auth0';

export const middleware = auth0.middleware;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
