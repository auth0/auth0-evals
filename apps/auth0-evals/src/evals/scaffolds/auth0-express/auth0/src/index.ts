import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createAuth0 } from '@auth0/auth0-express';

const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Standard Auth0 login: mounts /auth/login, /auth/callback, /auth/logout and
// attaches the Auth0 client to every request as `req.auth0`.
app.use(
  createAuth0({
    domain: process.env.AUTH0_DOMAIN as string,
    clientId: process.env.AUTH0_CLIENT_ID as string,
    clientSecret: process.env.AUTH0_CLIENT_SECRET as string,
    audience: process.env.AUTH0_AUDIENCE,
    appBaseUrl,
    sessionSecret: process.env.AUTH0_SESSION_SECRET as string,
  }),
);

async function requireSession(request: Request, response: Response, next: NextFunction): Promise<void> {
  const session = await request.auth0.client.getSession();

  if (!session) {
    response.redirect('/auth/login');
    return;
  }

  next();
}

app.get('/', async (request: Request, response: Response) => {
  const session = await request.auth0.client.getSession();
  response.send(session ? 'Logged in' : 'Logged out');
});

app.get('/profile', requireSession, async (request: Request, response: Response) => {
  const user = await request.auth0.client.getUser();
  response.json({ user });
});

app.post('/transfers', requireSession, async (request: Request, response: Response) => {
  const { amount, to } = request.body ?? {};

  const tokenSet = await request.auth0.client.getAccessToken();

  const upstream = await fetch(new URL('/transfers', process.env.AUTH0_AUDIENCE).toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenSet.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount, to }),
  });

  response.status(upstream.status).json(await upstream.json());
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Barkbook web listening on ${appBaseUrl}`);
});
