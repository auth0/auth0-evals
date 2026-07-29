/**
 * Verifies the judge's outbound auth. When proxy.authHeader is configured the
 * credential travels in that header alone; otherwise the original
 * `Authorization: Bearer <apiKey>` is sent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FrameworkConfig, ProxyAuthHeaderConfig } from '../../src/config/framework.js';

const okResponse = {
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: 'yes' } }], usage: {} }),
  text: async () => '',
};

describe('llmJudge auth header', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function callJudge(authHeader?: ProxyAuthHeaderConfig) {
    const { setFrameworkConfig } = await import('../../src/config/framework-config.js');
    setFrameworkConfig({
      evalsDir: '/evals',
      proxy: { baseUrl: 'https://llm.example.com/v1', ...(authHeader ? { authHeader } : {}) },
      mcp: { servers: {} },
      judge: { model: 'm', maxTokens: 1024, maxCodeChars: 16384 },
      models: { known: [], default: '', modelIds: {} },
      agents: {},
    } as unknown as Required<FrameworkConfig>);

    const fetchMock = vi.fn().mockResolvedValue(okResponse);
    vi.stubGlobal('fetch', fetchMock);

    const { llmJudge } = await import('../../src/graders/llm-judge.js');
    await llmJudge({
      question: 'Is it wired up?',
      code: '// code',
      apiKey: 'plain-api-key',
      model: 'claude-opus-5',
      baseUrl: 'https://llm.example.com/v1',
    });

    return (fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
  }

  it('sends Authorization: Bearer <apiKey> when no auth header is configured', async () => {
    const headers = await callJudge();
    expect(headers.Authorization).toBe('Bearer plain-api-key');
  });

  it('sends the configured header and drops Authorization when configured', async () => {
    vi.stubEnv('PROXY_TOKEN', 'jwt-xyz');
    const headers = await callJudge({
      name: 'x-litellm-api-key',
      valuePrefix: 'Bearer ',
      tokenEnv: 'PROXY_TOKEN',
    });
    expect(headers['x-litellm-api-key']).toBe('Bearer jwt-xyz');
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('keeps Content-Type in both modes', async () => {
    vi.stubEnv('PROXY_TOKEN', 'jwt-xyz');
    const headers = await callJudge({ name: 'x-api-key', tokenEnv: 'PROXY_TOKEN' });
    expect(headers['Content-Type']).toBe('application/json');
  });
});
