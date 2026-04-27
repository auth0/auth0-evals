/**
 * Tests for src/utils/retry.ts
 *
 * withRetry is tested with baseDelayMs: 0 to avoid real waits.
 * Delay scaling is verified with vi.useFakeTimers() + advanceTimersByTimeAsync.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withRetry, isTransientLlmError, RetryOptions } from '../src/utils/retry.js';
import { LlmApiError, BedrockToolConfigError } from '../src/errors.js';

// ── isTransientLlmError ───────────────────────────────────────────────────────

describe('isTransientLlmError', () => {
  describe('LlmApiError — transient HTTP statuses', () => {
    it.each([429, 500, 502, 503, 504])('returns true for status %i', (status) => {
      expect(isTransientLlmError(new LlmApiError(status, 'error'))).toBe(true);
    });
  });

  describe('LlmApiError — non-transient HTTP statuses', () => {
    it.each([400, 401, 403, 422])('returns false for status %i', (status) => {
      expect(isTransientLlmError(new LlmApiError(status, 'error'))).toBe(false);
    });
  });

  describe('network / timeout errors', () => {
    it('returns true for AbortError', () => {
      const e = Object.assign(new Error('aborted'), { name: 'AbortError' });
      expect(isTransientLlmError(e)).toBe(true);
    });

    it('returns true for TimeoutError', () => {
      const e = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      expect(isTransientLlmError(e)).toBe(true);
    });

    it('returns true for ECONNRESET', () => {
      expect(isTransientLlmError(new Error('read ECONNRESET'))).toBe(true);
    });

    it('returns true for ECONNREFUSED', () => {
      expect(isTransientLlmError(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toBe(true);
    });

    it('returns true for fetch failed', () => {
      expect(isTransientLlmError(new Error('fetch failed'))).toBe(true);
    });
  });

  describe('non-retryable errors', () => {
    it('returns false for BedrockToolConfigError', () => {
      expect(isTransientLlmError(new BedrockToolConfigError('claude-model'))).toBe(false);
    });

    it('returns false for a generic Error', () => {
      expect(isTransientLlmError(new Error('something unexpected'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
      expect(isTransientLlmError('string error')).toBe(false);
      expect(isTransientLlmError(null)).toBe(false);
      expect(isTransientLlmError(42)).toBe(false);
    });
  });
});

// ── withRetry — behaviour ─────────────────────────────────────────────────────

const NO_WAIT: RetryOptions = { baseDelayMs: 0 };

describe('withRetry — success paths', () => {
  it('resolves immediately when fn succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, NO_WAIT);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resolves on the second attempt after one transient failure', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new LlmApiError(503, 'unavailable')).mockResolvedValueOnce('recovered');
    const result = await withRetry(fn, NO_WAIT);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('resolves on the final attempt after maxAttempts-1 failures', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new LlmApiError(500, 'err'))
      .mockRejectedValueOnce(new LlmApiError(500, 'err'))
      .mockRejectedValueOnce(new LlmApiError(500, 'err'))
      .mockResolvedValueOnce('final');
    const result = await withRetry(fn, { ...NO_WAIT, maxAttempts: 4 });
    expect(result).toBe('final');
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe('withRetry — failure paths', () => {
  it('throws immediately for a non-retryable error without retrying', async () => {
    const err = new LlmApiError(400, 'bad request');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, NO_WAIT)).rejects.toThrow(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting all attempts for a persistent transient error', async () => {
    const err = new LlmApiError(503, 'unavailable');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { ...NO_WAIT, maxAttempts: 4 })).rejects.toThrow(err);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('throws immediately for BedrockToolConfigError without retrying', async () => {
    const err = new BedrockToolConfigError('claude-model');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, NO_WAIT)).rejects.toThrow(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original error type after exhaustion', async () => {
    const err = new LlmApiError(429, 'rate limited');
    const fn = vi.fn().mockRejectedValue(err);
    const thrown = await withRetry(fn, { ...NO_WAIT, maxAttempts: 2 }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(LlmApiError);
    expect((thrown as LlmApiError).status).toBe(429);
  });
});

describe('withRetry — delay scaling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits baseDelayMs * 2^attempt between retries (2s → 4s → 8s)', async () => {
    const BASE = 2_000;
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new LlmApiError(503, 'err')) // attempt 0 → wait 2 000 ms
      .mockRejectedValueOnce(new LlmApiError(503, 'err')) // attempt 1 → wait 4 000 ms
      .mockRejectedValueOnce(new LlmApiError(503, 'err')) // attempt 2 → wait 8 000 ms
      .mockResolvedValueOnce('done'); // attempt 3 → success

    const promise = withRetry(fn, { maxAttempts: 4, baseDelayMs: BASE });

    // Advance through all three sleep windows
    await vi.advanceTimersByTimeAsync(BASE); // 2 000 ms
    await vi.advanceTimersByTimeAsync(BASE * 2); // 4 000 ms
    await vi.advanceTimersByTimeAsync(BASE * 4); // 8 000 ms

    const result = await promise;
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe('withRetry — custom isRetryable', () => {
  it('respects a custom isRetryable predicate', async () => {
    const err = new Error('custom transient');
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
    const result = await withRetry(fn, {
      ...NO_WAIT,
      isRetryable: (e) => e instanceof Error && e.message === 'custom transient',
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('withRetry — invalid configuration', () => {
  it.each([0, -1, -100, 1.5, NaN])('throws RangeError for maxAttempts: %s', async (maxAttempts) => {
    await expect(withRetry(() => Promise.resolve('ok'), { maxAttempts })).rejects.toThrow(RangeError);
  });

  it.each([-1, -0.5, Infinity, -Infinity, NaN])('throws RangeError for baseDelayMs: %s', async (baseDelayMs) => {
    await expect(withRetry(() => Promise.resolve('ok'), { baseDelayMs })).rejects.toThrow(RangeError);
  });

  it('does not call fn when configuration is invalid', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { maxAttempts: 0 })).rejects.toThrow(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });
});
