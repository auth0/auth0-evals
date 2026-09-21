import express from 'express';
import type { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { authClient } from './auth0.js';

const app = express();
app.use(express.json());
app.use(cookieParser());

// Maps an opaque session id (browser cookie) to its PKCE code_verifier until the callback.
const verifiers = new Map<string, string>();

app.get('/login', async (_request: Request, response: Response) => {
  const { authorizationUrl, codeVerifier } = await authClient.buildAuthorizationUrl();

  const sid = randomUUID();
  verifiers.set(sid, codeVerifier);
  response.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' });
  response.redirect(authorizationUrl.toString());
});

app.get('/auth/callback', async (request: Request, response: Response) => {
  const sid = request.cookies?.sid as string | undefined;
  const codeVerifier = sid ? verifiers.get(sid) : undefined;
  if (!sid || !codeVerifier) {
    response.status(400).json({ error: 'no login in progress' });
    return;
  }
  verifiers.delete(sid);
  response.clearCookie('sid');

  try {
    const callbackUrl = new URL(request.url, `http://${request.headers.host ?? 'localhost:3000'}`);
    const tokens = await authClient.getTokenByCode(callbackUrl, { codeVerifier });
    response.json({ claims: tokens.claims, expiresAt: tokens.expiresAt });
  } catch (error) {
    response.status(401).json({ error: (error as Error).message });
  }
});

app.listen(3000, () => {
  console.log('Barkbook auth service listening on http://localhost:3000');
});
