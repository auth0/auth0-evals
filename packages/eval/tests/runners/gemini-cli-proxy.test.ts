/**
 * Unit tests for the ATKO proxy env-var injection in runGeminiCliAgent().
 *
 * Verifies that ATKO_API_KEY is forwarded as GEMINI_API_KEY and that
 * GOOGLE_GEMINI_BASE_URL is set to the ATKO LiteLLM proxy endpoint.
 * Achieved by stubbing process.env and capturing the env passed to spawn.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// ── Mock framework config ────────────────────────────────────────────────────

vi.mock('@a0/eval-core', async () => ({
  ...(await vi.importActual('@a0/eval-core')),
  getFrameworkConfig: vi.fn().mockReturnValue({
    proxy: { baseUrl: '<LLM_PROXY_URL>/v1' },
    mcp: {
      servers: {
        'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
      },
    },
  }),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { runGeminiCliAgent } from '../../src/runners/gemini-cli/agent.js';

let spawnMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.unstubAllEnvs();
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
  it('sets GOOGLE_GEMINI_BASE_URL to ATKO proxy when ATKO_API_KEY is set', async () => {
    vi.stubEnv('ATKO_API_KEY', 'test-atko-token');
    await triggerRun();
    expect(capturedEnv().GOOGLE_GEMINI_BASE_URL).toBe('<LLM_PROXY_URL>');
  });

  it('sets GEMINI_API_KEY to the value of ATKO_API_KEY', async () => {
    vi.stubEnv('ATKO_API_KEY', 'test-atko-token');
    await triggerRun();
    expect(capturedEnv().GEMINI_API_KEY).toBe('test-atko-token');
  });

  it('does not set GOOGLE_GEMINI_BASE_URL when ATKO_API_KEY is absent', async () => {
    vi.stubEnv('ATKO_API_KEY', '');
    await triggerRun();
    expect(capturedEnv()).not.toHaveProperty('GOOGLE_GEMINI_BASE_URL');
  });

  it('passes through the exact ATKO_API_KEY value as GEMINI_API_KEY', async () => {
    const token = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';
    vi.stubEnv('ATKO_API_KEY', token);
    await triggerRun();
    expect(capturedEnv().GEMINI_API_KEY).toBe(token);
  });
});
