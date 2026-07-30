import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FrameworkConfig, ProxyAuthHeaderConfig } from '../../src/config/framework.js';

describe('resolveProxyAuthHeader', () => {
  beforeEach(() => {
    vi.resetModules();
    // LLM_API_KEY takes precedence over proxy.authHeader, so it must be absent
    // for the header-path assertions below to exercise what they claim. Stubbed
    // rather than assumed: a developer machine may well export it.
    vi.stubEnv('LLM_API_KEY', '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /**
   * Loads a fresh copy of the module graph and seeds the config singleton.
   * vi.resetModules() is required because framework-config.ts holds module state.
   */
  async function withConfig(authHeader?: ProxyAuthHeaderConfig) {
    const { setFrameworkConfig } = await import('../../src/config/framework-config.js');
    setFrameworkConfig({
      evalsDir: '/evals',
      proxy: { baseUrl: 'https://llm.example.com/v1', ...(authHeader ? { authHeader } : {}) },
      mcp: { servers: {} },
      judge: { model: 'm', maxTokens: 1024, maxCodeChars: 16384 },
      models: { known: [], default: '', modelIds: {} },
      agents: {},
    } as unknown as Required<FrameworkConfig>);
    return await import('../../src/config/proxy-auth.js');
  }

  it('returns undefined when proxy.authHeader is not configured', async () => {
    const { resolveProxyAuthHeader } = await withConfig();
    expect(resolveProxyAuthHeader()).toBeUndefined();
  });

  it('composes valuePrefix + token when configured and the env var is set', async () => {
    vi.stubEnv('MY_PROXY_TOKEN', 'jwt-abc');
    const { resolveProxyAuthHeader } = await withConfig({
      name: 'x-litellm-api-key',
      valuePrefix: 'Bearer ',
      tokenEnv: 'MY_PROXY_TOKEN',
    });
    expect(resolveProxyAuthHeader()).toEqual({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-abc',
      tokenEnv: 'MY_PROXY_TOKEN',
    });
  });

  it('returns the bare token when valuePrefix is omitted', async () => {
    vi.stubEnv('MY_PROXY_TOKEN', 'jwt-abc');
    const { resolveProxyAuthHeader } = await withConfig({
      name: 'x-api-key',
      tokenEnv: 'MY_PROXY_TOKEN',
    });
    expect(resolveProxyAuthHeader()?.value).toBe('jwt-abc');
  });

  it('returns undefined and warns when the token env var is unset', async () => {
    vi.stubEnv('MY_PROXY_TOKEN', '');
    const mod = await withConfig({ name: 'x-api-key', tokenEnv: 'MY_PROXY_TOKEN' });
    const { logger } = await import('../../src/utils/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    expect(mod.resolveProxyAuthHeader()).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    // The warning must name the env var so a forgotten export is obvious.
    expect(warn.mock.calls[0]![0]).toContain('MY_PROXY_TOKEN');
  });

  it('never includes the token value in the warning', async () => {
    vi.stubEnv('MY_PROXY_TOKEN', '');
    const mod = await withConfig({ name: 'x-api-key', tokenEnv: 'MY_PROXY_TOKEN' });
    const { logger } = await import('../../src/utils/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mod.resolveProxyAuthHeader();
    expect(String(warn.mock.calls[0]![0])).not.toContain('jwt');
  });

  it('exposes the exact placeholder string', async () => {
    const { PLACEHOLDER_API_KEY } = await withConfig();
    expect(PLACEHOLDER_API_KEY).toBe('unused-see-proxy-auth-header');
  });

  // ── LLM_API_KEY precedence ──────────────────────────────────────────────────

  it('returns undefined when LLM_API_KEY is set, even with a valid authHeader', async () => {
    vi.stubEnv('LLM_API_KEY', 'legacy-key');
    vi.stubEnv('MY_PROXY_TOKEN', 'jwt-abc');
    const { resolveProxyAuthHeader } = await withConfig({
      name: 'x-litellm-api-key',
      valuePrefix: 'Bearer ',
      tokenEnv: 'MY_PROXY_TOKEN',
    });
    expect(resolveProxyAuthHeader()).toBeUndefined();
  });

  it('resolves the header once LLM_API_KEY is absent', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    vi.stubEnv('MY_PROXY_TOKEN', 'jwt-abc');
    const { resolveProxyAuthHeader } = await withConfig({
      name: 'x-litellm-api-key',
      valuePrefix: 'Bearer ',
      tokenEnv: 'MY_PROXY_TOKEN',
    });
    expect(resolveProxyAuthHeader()).toEqual({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-abc',
      tokenEnv: 'MY_PROXY_TOKEN',
    });
  });

  it('does not log the proxy token when LLM_API_KEY wins', async () => {
    vi.stubEnv('LLM_API_KEY', 'legacy-key');
    vi.stubEnv('MY_PROXY_TOKEN', 'jwt-secret-value');
    const mod = await withConfig({ name: 'x-api-key', tokenEnv: 'MY_PROXY_TOKEN' });
    const { logger } = await import('../../src/utils/logger.js');
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    mod.resolveProxyAuthHeader();
    expect(String(info.mock.calls[0]?.[0] ?? '')).not.toContain('jwt-secret-value');
  });
});
