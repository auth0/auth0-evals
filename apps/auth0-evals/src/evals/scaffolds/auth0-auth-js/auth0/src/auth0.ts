import { AuthClient } from '@auth0/auth0-auth-js';

export const authClient = new AuthClient({
  domain: process.env.AUTH0_DOMAIN as string,
  clientId: process.env.AUTH0_CLIENT_ID as string,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  authorizationParams: {
    redirect_uri: process.env.AUTH0_REDIRECT_URI as string,
    audience: process.env.AUTH0_AUDIENCE,
    scope: 'openid profile email',
  },
});
