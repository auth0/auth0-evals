import { describe, it, expect, vi, afterEach } from 'vitest';
import { mintMcpToken } from '../../src/config/mcp-auth.js';
import type { MCPOAuthConfig } from '../../src/config/framework.js';

const validAuth: MCPOAuthConfig = {
  tokenUrl: 'https://tenant.us.auth0.com/oauth/token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  audience: 'https://tenant.us.auth0.com/api/v2/',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mintMcpToken', () => {
  it('returns the access_token on a successful exchange', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await mintMcpToken(validAuth);

    expect(token).toBe('tok-123');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(validAuth.tokenUrl);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      grant_type: 'client_credentials',
      client_id: 'client-id',
      client_secret: 'client-secret',
      audience: validAuth.audience,
    });
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await mintMcpToken(validAuth)).toBeUndefined();
  });

  it('returns undefined without calling fetch when a credential is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const token = await mintMcpToken({ ...validAuth, clientSecret: '' });
    expect(token).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns undefined when the body has no access_token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await mintMcpToken(validAuth)).toBeUndefined();
  });
});
