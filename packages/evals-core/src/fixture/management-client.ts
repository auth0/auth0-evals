import type { ManagementApi } from '@a0/evals-graders';

export interface ManagementClientOptions {
  domain: string;
  clientId: string;
  clientSecret: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds. Defaults to 30s. */
  timeoutMs?: number;
  /**
   * Maximum retries, shared across HTTP 429 (all methods) and transient failures
   * (network errors, timeouts, 502/503/504 for GET, PUT and DELETE). Defaults to 3.
   */
  maxRetries?: number;
  /** Injectable for tests. Defaults to a real `setTimeout` wait. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_TTL_S = 86_400;
const MAX_RETRY_AFTER_MS = 60_000;
const ERROR_BODY_MAX_CHARS = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const REDACTED = '[redacted]';
const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'DELETE']);
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

export class ManagementApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Management API ${method} ${path} failed (${status}): ${body.slice(0, ERROR_BODY_MAX_CHARS)}`);
    this.name = 'ManagementApiError';
  }
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Replaces every occurrence of each secret in `text`, so error messages never leak credentials. */
function redact(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join(REDACTED);
  }
  return out;
}

/** A fetch network failure (`TypeError`) or an `AbortSignal.timeout` expiry (`TimeoutError`). */
function isTransientError(e: unknown): boolean {
  return e instanceof TypeError || (e as Error | undefined)?.name === 'TimeoutError';
}

/** Wait before a retry: `Retry-After` when present, otherwise exponential backoff, capped. */
function retryDelayMs(header: string | null, attempt: number): number {
  const seconds = Number(header);
  const waitMs =
    header !== null && header.trim() !== '' && Number.isFinite(seconds)
      ? seconds * 1000
      : BASE_BACKOFF_MS * 2 ** attempt;
  return Math.min(waitMs, MAX_RETRY_AFTER_MS);
}

/**
 * Builds a Management API v2 client authenticated with client credentials.
 * The access token is fetched lazily, cached in memory, and refreshed shortly
 * before it expires. HTTP 429 is retried with backoff for every method. Network errors, timeouts and
 * 502/503/504 are retried only for GET, PUT and DELETE (and for the token request), because a lost response
 * after a successful POST or PATCH must not be replayed. 500 is never retried. All retries share one budget of
 * `maxRetries`, and `Retry-After` is honored on 429 and 503. A `TimeoutError` thrown while reading a response
 * body is not retried. A 401 triggers a single token refresh, since a token can expire earlier than `expires_in`.
 */
export function createManagementClient(opts: ManagementClientOptions): ManagementApi {
  const domain = normalizeDomain(opts.domain);
  const fetchFn = opts.fetch ?? fetch;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let cached: CachedToken | null = null;
  let pendingToken: Promise<string> | null = null;

  /** Returns a valid token, sharing one in-flight request between concurrent callers. */
  async function getToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    pendingToken ??= fetchToken().finally(() => {
      pendingToken = null;
    });
    return pendingToken;
  }

  function postToken(): Promise<Response> {
    return fetchFn(`https://${domain}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        audience: `https://${domain}/api/v2/`,
      }),
    });
  }

  async function fetchToken(): Promise<string> {
    let retries = 0;
    let res: Response;
    for (;;) {
      try {
        res = await postToken();
      } catch (e) {
        if (isTransientError(e) && retries < maxRetries) {
          await sleep(retryDelayMs(null, retries++));
          continue;
        }
        throw e;
      }
      if ((res.status === 429 || TRANSIENT_STATUSES.has(res.status)) && retries < maxRetries) {
        await res.body?.cancel();
        await sleep(retryDelayMs(res.headers.get('retry-after'), retries++));
        continue;
      }
      break;
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ManagementApiError(res.status, 'POST', 'oauth/token', redact(text, [opts.clientSecret]));
    }

    let parsed: { access_token?: unknown; expires_in?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ManagementApiError(res.status, 'POST', 'oauth/token', 'token response was not valid JSON');
    }
    if (typeof parsed.access_token !== 'string' || !parsed.access_token) {
      throw new ManagementApiError(res.status, 'POST', 'oauth/token', 'token response had no access_token');
    }

    const ttlS = typeof parsed.expires_in === 'number' ? parsed.expires_in : DEFAULT_TOKEN_TTL_S;
    cached = { value: parsed.access_token, expiresAt: Date.now() + ttlS * 1000 - TOKEN_EXPIRY_MARGIN_MS };
    return cached.value;
  }

  async function request<T>(
    method: string,
    rawPath: string,
    query?: Record<string, string | number | boolean>,
    body?: unknown,
  ): Promise<T> {
    const path = rawPath.replace(/^\/+/, '');
    let url = `https://${domain}/api/v2/${path}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) qs.set(key, String(value));
      const qsText = qs.toString();
      if (qsText) url += `?${qsText}`;
    }

    const canRetry = IDEMPOTENT_METHODS.has(method);
    let retries = 0;
    let refreshedToken = false;
    for (;;) {
      const token = await getToken();
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (body !== undefined) headers['content-type'] = 'application/json';

      let res: Response;
      try {
        res = await fetchFn(url, {
          method,
          headers,
          signal: AbortSignal.timeout(timeoutMs),
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        if (canRetry && isTransientError(e) && retries < maxRetries) {
          await sleep(retryDelayMs(null, retries++));
          continue;
        }
        throw e;
      }

      if ((res.status === 429 || (canRetry && TRANSIENT_STATUSES.has(res.status))) && retries < maxRetries) {
        await res.body?.cancel();
        await sleep(retryDelayMs(res.headers.get('retry-after'), retries++));
        continue;
      }

      if (res.status === 401 && !refreshedToken) {
        await res.body?.cancel();
        refreshedToken = true;
        cached = null;
        continue;
      }

      const text = await res.text();
      if (!res.ok) {
        throw new ManagementApiError(res.status, method, path, redact(text, [opts.clientSecret, token]));
      }
      if (res.status === 204 || text.trim() === '') return undefined as T;
      return JSON.parse(text) as T;
    }
  }

  return {
    domain,
    get: (path, query) => request('GET', path, query),
    post: (path, body) => request('POST', path, undefined, body),
    patch: (path, body) => request('PATCH', path, undefined, body),
    put: (path, body) => request('PUT', path, undefined, body),
    delete: (path) => request('DELETE', path),
  };
}
