import { describe, it, expect, vi, afterEach } from 'vitest';
import { mintMcpToken, mcpBearerTokenEnvVar } from '../../src/config/mcp-auth.js';
import { logger } from '../../src/utils/logger.js';
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
      text: async () => JSON.stringify({ access_token: 'tok-123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await mintMcpToken(validAuth);

    expect(token).toBe('tok-123');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(validAuth.tokenUrl);
    // Form-encoded per RFC 6749 §4.4.2, not JSON.
    expect((init as RequestInit).headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
    });
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: 'client_credentials',
      client_id: 'client-id',
      client_secret: 'client-secret',
      audience: validAuth.audience,
    });
    // Fails fast on a hung endpoint rather than blocking job startup.
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '' }));
    expect(await mintMcpToken(validAuth)).toBeUndefined();
  });

  it('logs the response body on failure to aid diagnosis', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => '{"error":"access_denied","error_description":"Service not enabled"}',
      }),
    );

    expect(await mintMcpToken(validAuth)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('access_denied'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('403'));
  });

  it('returns undefined without calling fetch when a credential is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const token = await mintMcpToken({ ...validAuth, clientSecret: '' });
    expect(token).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns undefined when the body has no access_token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({}) }));
    expect(await mintMcpToken(validAuth)).toBeUndefined();
  });

  it('returns undefined and preserves the body when a 200 response is not valid JSON', async () => {
    // A proxy/gateway can return 200 with an HTML error page; JSON.parse throws
    // but the raw body must still be logged for diagnosis.
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<html>Bad Gateway</html>' }));

    expect(await mintMcpToken(validAuth)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Bad Gateway'));
  });

  it('returns undefined and logs the tokenUrl when fetch throws a network error', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    expect(await mintMcpToken(validAuth)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('network error'));
    // The endpoint is included so a DNS/TLS failure is distinguishable from misconfig.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(validAuth.tokenUrl));
  });
});

describe('mcpBearerTokenEnvVar', () => {
  it('uppercases and prefixes a simple server name', () => {
    expect(mcpBearerTokenEnvVar('auth0docs')).toBe('MCP_BEARER_AUTH0DOCS');
  });

  it('maps non-alphanumerics to underscores', () => {
    expect(mcpBearerTokenEnvVar('auth0-hosted-mcp')).toBe('MCP_BEARER_AUTH0_HOSTED_MCP');
    expect(mcpBearerTokenEnvVar('auth0.hosted')).toBe('MCP_BEARER_AUTH0_HOSTED');
  });

  it('collides for names differing only by punctuation (runners guard against this)', () => {
    // Documents the known collision the runner-level guard protects against.
    expect(mcpBearerTokenEnvVar('auth0-hosted')).toBe(mcpBearerTokenEnvVar('auth0.hosted'));
  });
});
