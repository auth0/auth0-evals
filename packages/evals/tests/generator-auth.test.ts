/**
 * Verifies the recommendation generator's outbound auth. When proxy.authHeader
 * is configured the credential travels in that header alone; otherwise the
 * original `Authorization: Bearer <apiKey>` is sent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FrameworkConfig, ProxyAuthHeaderConfig } from '@a0/evals-core';
import type { RecommendationInput } from '../src/recommendations/generator.js';

const okResponse = {
  ok: true,
  status: 200,
  json: async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            recommendations: [],
            summary: 'All good',
          }),
        },
      },
    ],
  }),
  text: async () => '',
};

describe('generateRecommendations auth header', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function callGenerator(authHeader?: ProxyAuthHeaderConfig) {
    const { setFrameworkConfig } = await import('@a0/evals-core');
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

    const { generateRecommendations } = await import('../src/recommendations/generator.js');
    const input: RecommendationInput = {
      evalId: 'test_eval',
      model: 'claude-opus-5',
      tools: ['skills'],
      userPrompt: 'Test task',
      workspace: '/tmp/workspace',
      scored: {
        evalId: 'test_eval',
        model: 'claude-opus-5',
        tools: ['skills'],
        graderResults: [],
        dimensions: [],
        overallScore: 85,
        overallGrade: 'B',
        graderPassRate: 0.9,
        level: 'medium',
      },
      record: {
        toolCalls: [],
        providerErrors: [],
        startTime: Date.now(),
        endTime: Date.now(),
      },
      skillContent: '',
      apiKey: 'plain-api-key',
      baseUrl: 'https://llm.example.com/v1',
      judgeModel: 'claude-opus-5',
    };

    await generateRecommendations(input);

    return (fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
  }

  it('sends Authorization: Bearer <apiKey> when no auth header is configured', async () => {
    const headers = await callGenerator();
    expect(headers.Authorization).toBe('Bearer plain-api-key');
  });

  it('sends the configured header and drops Authorization when configured', async () => {
    vi.stubEnv('PROXY_TOKEN', 'jwt-xyz');
    const headers = await callGenerator({
      name: 'x-litellm-api-key',
      valuePrefix: 'Bearer ',
      tokenEnv: 'PROXY_TOKEN',
    });
    expect(headers['x-litellm-api-key']).toBe('Bearer jwt-xyz');
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('keeps Content-Type in both modes', async () => {
    vi.stubEnv('PROXY_TOKEN', 'jwt-xyz');
    const headers = await callGenerator({ name: 'x-api-key', tokenEnv: 'PROXY_TOKEN' });
    expect(headers['Content-Type']).toBe('application/json');
  });
});
