import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('framework-config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function freshModule() {
    return await import('../../src/config/framework-config.js');
  }

  const minimalConfig = {
    evalsDir: '/evals',
    proxy: { baseUrl: 'http://localhost:4000' },
    judge: { model: 'claude-sonnet-4-5', maxTokens: 1024, maxCodeChars: 16384 },
    models: { known: [], modelIds: {} },
    agents: {},
  } as any;

  it('getFrameworkConfig throws before setFrameworkConfig is called', async () => {
    const { getFrameworkConfig } = await freshModule();
    expect(() => getFrameworkConfig()).toThrow('FrameworkConfig not initialized');
  });

  it('setFrameworkConfig + getFrameworkConfig round-trips', async () => {
    const { setFrameworkConfig, getFrameworkConfig } = await freshModule();
    setFrameworkConfig(minimalConfig);
    expect(getFrameworkConfig()).toBe(minimalConfig);
  });

  it('getAgentProxyBaseUrl returns agent-specific proxy when configured', async () => {
    const { setFrameworkConfig, getAgentProxyBaseUrl } = await freshModule();
    const config = {
      ...minimalConfig,
      agents: {
        'claude-code': { proxy: { baseUrl: 'http://agent-proxy:5000' } },
      },
    };
    setFrameworkConfig(config as any);
    expect(getAgentProxyBaseUrl('claude-code')).toBe('http://agent-proxy:5000');
  });

  it('getAgentProxyBaseUrl falls back to global proxy.baseUrl', async () => {
    const { setFrameworkConfig, getAgentProxyBaseUrl } = await freshModule();
    setFrameworkConfig(minimalConfig);
    expect(getAgentProxyBaseUrl('copilot')).toBe('http://localhost:4000');
  });
});
