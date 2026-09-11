import { CookieTransactionStore, ServerClient, StatelessStateStore } from '@auth0/auth0-server-js';
import { ExpressCookieHandler } from './store/express-cookie-handler.js';
import type { StoreOptions } from './types.js';

export const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

const cookieHandler = new ExpressCookieHandler();
const sessionSecret = process.env.AUTH0_SESSION_SECRET as string;

export const serverClient = new ServerClient<StoreOptions>({
  domain: process.env.AUTH0_DOMAIN as string,
  clientId: process.env.AUTH0_CLIENT_ID as string,
  clientSecret: process.env.AUTH0_CLIENT_SECRET as string,
  authorizationParams: {
    redirect_uri: new URL('/auth/callback', appBaseUrl).toString(),
    audience: process.env.AUTH0_AUDIENCE,
    scope: 'openid profile email offline_access',
  },
  transactionStore: new CookieTransactionStore({ secret: sessionSecret }, cookieHandler),
  stateStore: new StatelessStateStore({ secret: sessionSecret }, cookieHandler),
});
