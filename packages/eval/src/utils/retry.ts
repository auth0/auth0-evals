/**
 * Exponential-backoff retry utility for transient LLM API errors.
 *
 * Default schedule (3 retries after the initial attempt):
 *   attempt 1 fails → wait 2 s → attempt 2
 *   attempt 2 fails → wait 4 s → attempt 3
 *   attempt 3 fails → wait 8 s → attempt 4
 *   attempt 4 fails → throw
 *
 * Retryable errors (HTTP): 429, 500, 502, 503, 504
 * Retryable errors (network): timeout (AbortError / TimeoutError), ECONNRESET, ECONNREFUSED
 * Never retried: 400, 401, 403, 422, BedrockToolConfigError (config bugs, not transient)
 */

import { BedrockToolConfigError, LlmApiError } from '../errors.js';
import { logger } from './logger.js';

// ── Retryability predicate ────────────────────────────────────────────────────

const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isTransientLlmError(error: unknown): boolean {
  // Explicit guard — must never be retried regardless of message or name,
  // so this check is intentional rather than relying on heuristics below.
  if (error instanceof BedrockToolConfigError) {
    return false;
  }
  if (error instanceof LlmApiError) {
    return TRANSIENT_HTTP_STATUSES.has(error.status);
  }
  if (error instanceof Error) {
    // AbortSignal.timeout() throws DOMException('TimeoutError') in Node 18+
    // and Error('AbortError') in older runtimes.
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return true;
    }
    const msg = error.message.toLowerCase();
    return msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('fetch failed');
  }
  return false;
}

// ── Core utility ──────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Total number of attempts including the first. Default: 4 (= 3 retries). */
  maxAttempts?: number;
  /** Delay before the first retry in ms. Doubles on each subsequent retry. Default: 2000. */
  baseDelayMs?: number;
  /** Return true if the error warrants a retry. Default: isTransientLlmError. */
  isRetryable?: (error: unknown) => boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 4, baseDelayMs = 2_000, isRetryable = isTransientLlmError } = opts;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`withRetry: maxAttempts must be a positive integer, got ${maxAttempts}`);
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError(`withRetry: baseDelayMs must be a non-negative finite number, got ${baseDelayMs}`);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts - 1;

      if (isLastAttempt || !isRetryable(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** attempt;
      logger.info(
        `  [retry] Attempt ${attempt + 1}/${maxAttempts} failed — ${error}. ` + `Retrying in ${delayMs / 1_000}s...`,
      );
      await sleep(delayMs);
    }
  }

  // Unreachable — the loop always returns or throws before exhausting attempts.
  // TypeScript requires this to satisfy the return type.
  throw new Error('withRetry: exhausted all attempts');
}
