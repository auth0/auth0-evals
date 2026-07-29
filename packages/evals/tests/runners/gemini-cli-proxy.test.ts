/**
 * Unit tests for the LLM proxy env-var injection in runGeminiCliAgent().
 *
 * Verifies that the LLM API key is forwarded as GEMINI_API_KEY and that
 * GOOGLE_GEMINI_BASE_URL is set to the LiteLLM proxy endpoint.
 * Achieved by stubbing process.env and capturing the env passed to spawn.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// ── Mock framework config ────────────────────────────────────────────────────

const mockResolveProxyAuthHeader = vi.hoisted(() => vi.fn().mockReturnValue(undefined));

vi.mock('@a0/evals-core', async () => ({
  ...(await vi.importActual('@a0/evals-core')),
  getFrameworkConfig: vi.fn().mockReturnValue({
    proxy: { baseUrl: 'https://llm.example.com/v1' },
    mcp: {
      servers: {
        'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
      },
    },
    agents: {
      'gemini-cli': { proxy: { baseUrl: 'http://127.0.0.1:12345' } },
    },
  }),
  getAgentProxyBaseUrl: vi.fn().mockReturnValue('http://127.0.0.1:12345'),
  resolveProxyAuthHeader: mockResolveProxyAuthHeader,
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { runGeminiCliAgent } from '../../src/runners/gemini-cli/agent.js';

let spawnMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.unstubAllEnvs();
  mockResolveProxyAuthHeader.mockReturnValue(undefined);
  const cp = await import('node:child_process');
  spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>;
  spawnMock.mockReset();

  // Each call to spawn returns a minimal child stub and immediately emits
  // 'close' (after listeners are attached) so the agent promise resolves.
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      kill: () => void;
    };
    // readline.createInterface requires a proper Readable (needs resume()).
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.kill = () => {};
    // Emit close after the agent has had a chance to attach its listener.
    setImmediate(() => child.emit('close', 0));
    return child;
  });
});

function capturedEnv(): Record<string, string> {
  const call = spawnMock.mock.calls[0] as [string, string[], SpawnOptionsWithoutStdio];
  return (call[2]?.env ?? {}) as Record<string, string>;
}

async function triggerRun() {
  await runGeminiCliAgent({ id: 'test', userPrompt: 'hello' }, '/tmp/workspace', {
    model: 'gemini-2.5-flash',
  });
}

describe('runGeminiCliAgent proxy env injection', () => {
  it('sets GOOGLE_GEMINI_BASE_URL to local proxy when LLM_API_KEY is set', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-llm-token');
    await triggerRun();
    expect(capturedEnv().GOOGLE_GEMINI_BASE_URL).toBe('http://127.0.0.1:12345');
  });

  it('sets GEMINI_API_KEY to the value of LLM_API_KEY', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-llm-token');
    await triggerRun();
    expect(capturedEnv().GEMINI_API_KEY).toBe('test-llm-token');
  });

  it('does not set GOOGLE_GEMINI_BASE_URL when LLM_API_KEY is absent', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    await triggerRun();
    expect(capturedEnv()).not.toHaveProperty('GOOGLE_GEMINI_BASE_URL');
  });

  it('passes through the exact LLM_API_KEY value as GEMINI_API_KEY', async () => {
    const token = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';
    vi.stubEnv('LLM_API_KEY', token);
    await triggerRun();
    expect(capturedEnv().GEMINI_API_KEY).toBe(token);
  });
});

describe('runGeminiCliAgent proxy auth header', () => {
  it('sets GEMINI_CLI_CUSTOM_HEADERS when configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-llm-token');
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await triggerRun();
    expect(capturedEnv().GEMINI_CLI_CUSTOM_HEADERS).toBe('x-litellm-api-key: Bearer jwt-xyz');
  });

  it('sets GEMINI_API_KEY to the placeholder when configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-llm-token');
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await triggerRun();
    // Non-empty is mandatory: validateAuthMethod rejects the run otherwise.
    expect(capturedEnv().GEMINI_API_KEY).toBe('unused-see-proxy-auth-header');
  });

  it('still routes through the proxy base URL when configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-llm-token');
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await triggerRun();
    expect(capturedEnv().GOOGLE_GEMINI_BASE_URL).toBe('http://127.0.0.1:12345');
  });

  it('sets the header even when LLM_API_KEY is absent', async () => {
    // The auth header is the credential; LLM_API_KEY is irrelevant in this mode.
    vi.stubEnv('LLM_API_KEY', '');
    mockResolveProxyAuthHeader.mockReturnValue({
      name: 'x-litellm-api-key',
      value: 'Bearer jwt-xyz',
      tokenEnv: 'PROXY_TOKEN',
    });
    await triggerRun();
    expect(capturedEnv().GEMINI_CLI_CUSTOM_HEADERS).toBe('x-litellm-api-key: Bearer jwt-xyz');
    expect(capturedEnv().GOOGLE_GEMINI_BASE_URL).toBe('http://127.0.0.1:12345');
  });

  it('does not set GEMINI_CLI_CUSTOM_HEADERS when not configured', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-llm-token');
    mockResolveProxyAuthHeader.mockReturnValue(undefined);
    await triggerRun();
    expect(capturedEnv()).not.toHaveProperty('GEMINI_CLI_CUSTOM_HEADERS');
    expect(capturedEnv().GEMINI_API_KEY).toBe('test-llm-token');
  });
});
