/**
 * Unit tests for geminiProxyEnv() in gemini-cli/proxy.ts.
 *
 * Verifies env var reading, routing configuration, and warning behaviour
 * by stubbing process.env before each call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { geminiProxyEnv } from '../src/agent_eval/runners/gemini-cli/proxy.js';

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('geminiProxyEnv', () => {
  it('returns ATKO LiteLLM proxy env vars when GEMINI_API_KEY is set', () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-litellm-token');

    const env = geminiProxyEnv();

    expect(env.GOOGLE_GEMINI_BASE_URL).toBe('https://llm.atko.ai');
    expect(env.GEMINI_API_KEY).toBe('test-litellm-token');
  });

  it('returns empty object when GEMINI_API_KEY is not set', () => {
    vi.stubEnv('GEMINI_API_KEY', '');

    const env = geminiProxyEnv();

    expect(env).toEqual({});
  });

  it('does not include GOOGLE_GEMINI_BASE_URL when GEMINI_API_KEY is missing', () => {
    vi.stubEnv('GEMINI_API_KEY', '');

    const env = geminiProxyEnv();

    expect(env).not.toHaveProperty('GOOGLE_GEMINI_BASE_URL');
  });

  it('passes through the exact GEMINI_API_KEY value set in env', () => {
    const token = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';
    vi.stubEnv('GEMINI_API_KEY', token);

    const env = geminiProxyEnv();

    expect(env.GEMINI_API_KEY).toBe(token);
  });
});
