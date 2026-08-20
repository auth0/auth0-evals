import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Request, Response } from 'express';
import { appBaseUrl, serverClient } from './auth0.js';

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/auth/login', async (request: Request, response: Response) => {
  const authorizationUrl = await serverClient.startInteractiveLogin({}, { request, response });
  response.redirect(authorizationUrl.href);
});

app.get('/auth/callback', async (request: Request, response: Response) => {
  await serverClient.completeInteractiveLogin(new URL(request.url, appBaseUrl), {
    request,
    response,
  });
  response.redirect('/profile');
});

app.get('/auth/logout', async (request: Request, response: Response) => {
  const logoutUrl = await serverClient.logout({ returnTo: appBaseUrl }, { request, response });
  response.redirect(logoutUrl.href);
});

app.get('/profile', async (request: Request, response: Response) => {
  const user = await serverClient.getUser({ request, response });

  if (!user) {
    response.redirect('/auth/login');
    return;
  }

  response.json({ user });
});

app.post('/transfers', async (request: Request, response: Response) => {
  const { amount, to } = request.body ?? {};

  const tokenSet = await serverClient.getAccessToken({ request, response });

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

app.listen(3000, () => {
  console.log(`Barkbook web listening on ${appBaseUrl}`);
});
