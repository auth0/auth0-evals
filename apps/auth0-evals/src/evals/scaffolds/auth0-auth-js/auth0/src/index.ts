import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { audience, authClient } from './auth0.js';

const app = express();
app.use(express.json());

app.post('/login', async (request: Request, response: Response) => {
  const { username, password } = request.body ?? {};

  if (!username || !password) {
    response.status(400).json({ error: 'username and password are required' });
    return;
  }

  try {
    const tokens = await authClient.getTokenByPassword({
      username,
      password,
      audience,
      scope: 'openid profile email offline_access',
    });

    response.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
  } catch (error) {
    response.status(401).json({ error: (error as Error).message });
  }
});

app.post('/refresh', async (request: Request, response: Response) => {
  const { refreshToken } = request.body ?? {};

  if (!refreshToken) {
    response.status(400).json({ error: 'refreshToken is required' });
    return;
  }

  try {
    const tokens = await authClient.getTokenByRefreshToken({ refreshToken });
    response.json({ accessToken: tokens.accessToken, expiresAt: tokens.expiresAt });
  } catch (error) {
    response.status(401).json({ error: (error as Error).message });
  }
});

app.listen(3000, () => {
  console.log('Barkbook auth service listening on http://localhost:3000');
});
