/**
 * Tests for the judge request fingerprint (`judgeInputHash`).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { buildJudgeRequest, llmJudge } from '../../src/graders/llm-judge.js';
import { JudgeError } from '../../src/errors.js';

const BASE = {
  question: 'Does it use Auth0Provider?',
  code: 'const a = 1;',
  model: 'claude-opus-5',
  baseUrl: 'https://proxy.example/v1',
  maxTokens: 1024,
  maxCodeChars: 1000,
};

const hashOf = (over: Partial<Parameters<typeof buildJudgeRequest>[0]> = {}) =>
  buildJudgeRequest({ ...BASE, ...over }).judgeInputHash;

describe('buildJudgeRequest', () => {
  it('is deterministic and is the sha256 hex of the payload', () => {
    const a = buildJudgeRequest(BASE);
    expect(buildJudgeRequest(BASE)).toEqual(a);
    expect(a.judgeInputHash).toBe(createHash('sha256').update(a.payload).digest('hex'));
  });

  it.each([
    ['question', { question: 'Is it correct?' }],
    ['context', { context: 'The app is a SPA.' }],
    ['model', { model: 'claude-sonnet-5' }],
    ['maxTokens', { maxTokens: 2048 }],
    ['code', { code: 'const a = 2;' }],
  ])('changes when %s changes', (_name, over) => {
    expect(hashOf(over)).not.toBe(hashOf());
  });

  it('is unaffected by baseUrl (and never sees apiKey)', () => {
    expect(hashOf({ baseUrl: 'https://other.example/v1' })).toBe(hashOf());
    const withKey = buildJudgeRequest({ ...BASE, apiKey: 'secret-key' } as never);
    expect(withKey.payload).not.toContain('secret-key');
    expect(withKey.judgeInputHash).toBe(hashOf());
  });

  it('hashes the truncated corpus when enforceMaxChars is on', () => {
    const head = 'a'.repeat(1500);
    const x = hashOf({ code: head + 'X'.repeat(2000), enforceMaxChars: true });
    const y = hashOf({ code: head + 'Y'.repeat(2000), enforceMaxChars: true });
    expect(x).toBe(y);
    // Without enforcement the whole corpus is sent, so the difference is visible.
    expect(hashOf({ code: head + 'X'.repeat(2000), enforceMaxChars: false })).not.toBe(
      hashOf({ code: head + 'Y'.repeat(2000), enforceMaxChars: false }),
    );
  });

  it('throws JudgeError without a model or baseUrl', () => {
    expect(() => buildJudgeRequest({ ...BASE, model: '' })).toThrow(JudgeError);
    expect(() => buildJudgeRequest({ ...BASE, baseUrl: '' })).toThrow(JudgeError);
  });
});

describe('llmJudge judgeInputHash', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('equals the sha256 of the request body actually sent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Fine.\n\nyes' } }] }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await llmJudge({ ...BASE, apiKey: 'key', code: 'x'.repeat(3000), enforceMaxChars: true });

    const body = (fetchMock.mock.calls[0][1] as { body: string }).body;
    expect(result.judgeInputHash).toBe(createHash('sha256').update(body).digest('hex'));
    expect(result.judgeInputHash).toBe(hashOf({ code: 'x'.repeat(3000), enforceMaxChars: true }));
  });

  it('gives the same hash regardless of apiKey', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'yes' } }] }),
      } as unknown as Response),
    );
    const a = await llmJudge({ ...BASE, apiKey: 'one' });
    const b = await llmJudge({ ...BASE, apiKey: 'two' });
    expect(a.judgeInputHash).toBe(b.judgeInputHash);
  });
});
