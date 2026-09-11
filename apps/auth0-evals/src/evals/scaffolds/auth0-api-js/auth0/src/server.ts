import express from 'express';
import type { Request, Response } from 'express';
import { apiClient } from './auth0.js';

const app = express();
app.use(express.json());

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

app.get('/api/balance', async (request: Request, response: Response) => {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    response.status(401).json({ error: 'Missing Bearer token' });
    return;
  }

  try {
    const claims = await apiClient.verifyAccessToken({ accessToken });
    response.json({ balance: 4200, sub: claims.sub });
  } catch (error) {
    response.status(401).json({ error: (error as Error).message });
  }
});

app.post('/api/transfers', async (request: Request, response: Response) => {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    response.status(401).json({ error: 'Missing Bearer token' });
    return;
  }

  try {
    const claims = await apiClient.verifyAccessToken({ accessToken });
    const { amount, to } = request.body ?? {};
    response.status(201).json({ transferred: amount, to, sub: claims.sub });
  } catch (error) {
    response.status(401).json({ error: (error as Error).message });
  }
});

const port = process.env.PORT ?? 3001;
app.listen(port, () => console.log(`Barkbook API listening on http://localhost:${port}`));
