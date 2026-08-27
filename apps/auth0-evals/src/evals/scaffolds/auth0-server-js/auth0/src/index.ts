import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { appBaseUrl, serverClient } from './auth0.js';

const app = express();
const authRateLimitWindowMs = 60_000;
const authRateLimitMaxRequests = 10;
const authRequestCounts = new Map<string, { count: number; resetAt: number }>();

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function rateLimitAuthRoute(request: Request, response: Response, next: NextFunction) {
  const key = request.ip || request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const existing = authRequestCounts.get(key);

  if (!existing || existing.resetAt <= now) {
    authRequestCounts.set(key, { count: 1, resetAt: now + authRateLimitWindowMs });
    next();
    return;
  }

  if (existing.count >= authRateLimitMaxRequests) {
    response.status(429).json({ error: 'too_many_requests' });
    return;
  }

  existing.count += 1;
  next();
}

app.get('/auth/login', rateLimitAuthRoute, async (request: Request, response: Response) => {
  const authorizationUrl = await serverClient.startInteractiveLogin({}, { request, response });
  response.redirect(authorizationUrl.href);
});

app.get('/auth/callback', rateLimitAuthRoute, async (request: Request, response: Response) => {
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
