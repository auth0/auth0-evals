/**
 * Tests for src/fixture/management-client.ts
 *
 * fetch and sleep are injected, so no network access or real waits occur.
 */

import { vi, describe, it, expect } from 'vitest';
import { createManagementClient, ManagementApiError } from '../src/fixture/management-client.js';

const SECRET = 'super-secret-client-secret';
const TOKEN = 'tok_abc123';

function tokenResponse(token = TOKEN, expiresIn = 86400): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function setup(responses: Array<Response | (() => Response)>, extra: { maxRetries?: number } = {}) {
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch call');
    return typeof next === 'function' ? next() : next;
  });
  const sleep = vi.fn(async (_ms: number) => {});
  const client = createManagementClient({
    domain: 'acme.auth0.com',
    clientId: 'client-id',
    clientSecret: SECRET,
    fetch: fetchMock as unknown as typeof fetch,
    sleep,
    ...extra,
  });
  return { client, fetchMock, sleep };
}

/** A response whose body stream reports when it is cancelled. */
function trackedResponse(status: number, onCancel: () => void): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('discard me'));
    },
    cancel() {
      onCancel();
    },
  });
  return new Response(body, { status });
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe('createManagementClient', () => {
  describe('token handling', () => {
    it('fetches the token once and reuses it across calls', async () => {
      const { client, fetchMock } = setup([tokenResponse(), jsonResponse({ a: 1 }), jsonResponse({ b: 2 })]);

      await client.get('clients');
      await client.get('connections');

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.filter((u) => u.endsWith('/oauth/token'))).toHaveLength(1);
      expect(headersOf(fetchMock.mock.calls[1][1]).authorization).toBe(`Bearer ${TOKEN}`);
      expect(headersOf(fetchMock.mock.calls[2][1]).authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('sends the client credentials grant with the API audience', async () => {
      const { client, fetchMock } = setup([tokenResponse(), jsonResponse({})]);

      await client.get('clients');

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('https://acme.auth0.com/oauth/token');
      expect(init?.method).toBe('POST');
      expect(headersOf(init)['content-type']).toBe('application/json');
      expect(JSON.parse(init?.body as string)).toEqual({
        grant_type: 'client_credentials',
        client_id: 'client-id',
        client_secret: SECRET,
        audience: 'https://acme.auth0.com/api/v2/',
      });
    });

    it('fetches a new token after the cached one is within 60s of expiry', async () => {
      // expires_in 30s is already inside the 60s safety margin
      const { client, fetchMock } = setup([
        tokenResponse('tok_1', 30),
        jsonResponse({}),
        tokenResponse('tok_2', 30),
        jsonResponse({}),
      ]);

      await client.get('clients');
      await client.get('clients');

      expect(headersOf(fetchMock.mock.calls[3][1]).authorization).toBe('Bearer tok_2');
    });

    it('redacts the client secret when the token endpoint echoes it', async () => {
      const { client } = setup([new Response(`invalid client_secret ${SECRET} for client`, { status: 401 })]);

      const err = await client.get('clients').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ManagementApiError);
      const apiErr = err as ManagementApiError;
      expect(apiErr.status).toBe(401);
      expect(apiErr.method).toBe('POST');
      expect(apiErr.path).toBe('oauth/token');
      expect(apiErr.message).toContain('[redacted]');
      expect(apiErr.message).not.toContain(SECRET);
      expect(apiErr.body).not.toContain(SECRET);
    });
    it('shares one token request between concurrent first calls', async () => {
      const { client, fetchMock } = setup([tokenResponse(), jsonResponse({ a: 1 }), jsonResponse({ b: 2 })]);

      await Promise.all([client.get('a'), client.get('b')]);

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.filter((u) => u.endsWith('/oauth/token'))).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('request building', () => {
    it('normalizes the domain', async () => {
      const fetchMock = vi.fn(async (url: string | URL | Request) =>
        String(url).endsWith('/oauth/token') ? tokenResponse() : jsonResponse({}),
      );
      const client = createManagementClient({
        domain: 'https://x.auth0.com/',
        clientId: 'id',
        clientSecret: SECRET,
        fetch: fetchMock as unknown as typeof fetch,
      });

      await client.get('clients');

      expect(client.domain).toBe('x.auth0.com');
      expect(String(fetchMock.mock.calls[0][0])).toBe('https://x.auth0.com/oauth/token');
      expect(String(fetchMock.mock.calls[1][0])).toBe('https://x.auth0.com/api/v2/clients');
    });

    it('strips an http:// prefix and multiple trailing slashes', () => {
      const client = createManagementClient({ domain: 'http://y.auth0.com//', clientId: 'id', clientSecret: SECRET });
      expect(client.domain).toBe('y.auth0.com');
    });

    it('strips a leading slash from the path', async () => {
      const { client, fetchMock } = setup([tokenResponse(), jsonResponse({})]);

      await client.get('/clients');

      expect(String(fetchMock.mock.calls[1][0])).toBe('https://acme.auth0.com/api/v2/clients');
    });

    it('builds the query string, stringifying booleans and numbers', async () => {
      const { client, fetchMock } = setup([tokenResponse(), jsonResponse([])]);

      await client.get('clients', { per_page: 50, include_totals: true, name: 'a b' });

      const url = new URL(String(fetchMock.mock.calls[1][0]));
      expect(url.pathname).toBe('/api/v2/clients');
      expect(url.searchParams.get('per_page')).toBe('50');
      expect(url.searchParams.get('include_totals')).toBe('true');
      expect(url.searchParams.get('name')).toBe('a b');
    });

    it('sends a JSON body and content-type only when a body is present', async () => {
      const { client, fetchMock } = setup([tokenResponse(), jsonResponse({ ok: 1 }), jsonResponse({})]);

      await client.post('clients', { name: 'app' });
      await client.get('clients');

      const [, withBody] = fetchMock.mock.calls[1];
      expect(withBody?.method).toBe('POST');
      expect(withBody?.body).toBe(JSON.stringify({ name: 'app' }));
      expect(headersOf(withBody)['content-type']).toBe('application/json');

      const [, withoutBody] = fetchMock.mock.calls[2];
      expect(withoutBody?.method).toBe('GET');
      expect(withoutBody?.body).toBeUndefined();
      expect(headersOf(withoutBody)).not.toHaveProperty('content-type');
    });

    it.each([
      ['patch', 'PATCH'],
      ['put', 'PUT'],
    ] as const)('%s uses the %s method with a body', async (fn, method) => {
      const { client, fetchMock } = setup([tokenResponse(), jsonResponse({})]);

      await client[fn]('clients/abc', { x: 1 });

      expect(fetchMock.mock.calls[1][1]?.method).toBe(method);
      expect(fetchMock.mock.calls[1][1]?.body).toBe('{"x":1}');
    });

    it('delete uses the DELETE method', async () => {
      const { client, fetchMock } = setup([tokenResponse(), new Response(null, { status: 204 })]);

      await client.delete('clients/abc');

      expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');
    });
  });

  describe('responses', () => {
    it('parses JSON bodies', async () => {
      const { client } = setup([tokenResponse(), jsonResponse({ client_id: 'abc' })]);
      await expect(client.get('clients/abc')).resolves.toEqual({ client_id: 'abc' });
    });

    it('returns undefined for 204', async () => {
      const { client } = setup([tokenResponse(), new Response(null, { status: 204 })]);
      await expect(client.delete('clients/abc')).resolves.toBeUndefined();
    });

    it('returns undefined for an empty 200 body', async () => {
      const { client } = setup([tokenResponse(), new Response('', { status: 200 })]);
      await expect(client.get('clients/abc')).resolves.toBeUndefined();
    });
  });

  describe('retries', () => {
    it('waits Retry-After seconds on 429, then succeeds', async () => {
      const { client, sleep, fetchMock } = setup([
        tokenResponse(),
        new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
        jsonResponse({ ok: true }),
      ]);

      await expect(client.get('clients')).resolves.toEqual({ ok: true });

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(2000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('caps a huge Retry-After at 60 seconds', async () => {
      const { client, sleep } = setup([
        tokenResponse(),
        new Response('', { status: 429, headers: { 'retry-after': '3600' } }),
        jsonResponse({}),
      ]);

      await client.get('clients');

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(60000);
    });

    it('cancels the discarded 429 response body before retrying', async () => {
      const cancelled = vi.fn();
      const { client } = setup([tokenResponse(), () => trackedResponse(429, cancelled), jsonResponse({})]);

      await client.get('clients');

      expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('cancels the discarded 401 response body before refreshing the token', async () => {
      const cancelled = vi.fn();
      const { client } = setup([
        tokenResponse('tok_old'),
        () => trackedResponse(401, cancelled),
        tokenResponse('tok_new'),
        jsonResponse({}),
      ]);

      await client.get('clients');

      expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('uses exponential backoff when Retry-After is missing or non-numeric', async () => {
      const { client, sleep } = setup([
        tokenResponse(),
        new Response('', { status: 429 }),
        new Response('', { status: 429, headers: { 'retry-after': 'soon' } }),
        new Response('', { status: 429 }),
        jsonResponse({}),
      ]);

      await client.get('clients');

      expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000, 2000]);
    });

    it('uses exponential backoff when Retry-After is empty', async () => {
      const { client, sleep } = setup([
        tokenResponse(),
        new Response('', { status: 429, headers: { 'retry-after': '' } }),
        jsonResponse({}),
      ]);

      await client.get('clients');

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(500);
    });

    it('throws ManagementApiError with status 429 once retries are exhausted', async () => {
      const { client, sleep, fetchMock } = setup(
        [
          tokenResponse(),
          new Response('limit', { status: 429 }),
          new Response('limit', { status: 429 }),
          new Response('limit', { status: 429 }),
        ],
        { maxRetries: 2 },
      );

      const err = await client.get('clients').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ManagementApiError);
      expect((err as ManagementApiError).status).toBe(429);
      expect(sleep).toHaveBeenCalledTimes(2);
      // 1 token call + initial attempt + 2 retries
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('retries a 429 from the token endpoint, then succeeds', async () => {
      const cancelled = vi.fn();
      const { client, sleep, fetchMock } = setup([
        () => trackedResponse(429, cancelled),
        tokenResponse(),
        jsonResponse({ ok: true }),
      ]);

      await expect(client.get('clients')).resolves.toEqual({ ok: true });

      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(500);
      expect(String(fetchMock.mock.calls[1]![0])).toContain('/oauth/token');
    });

    it('throws a 429 from the token endpoint once retries are exhausted', async () => {
      const { client, sleep, fetchMock } = setup(
        [
          new Response('limit', { status: 429, headers: { 'retry-after': '1' } }),
          new Response('limit', { status: 429, headers: { 'retry-after': '1' } }),
          new Response('limit', { status: 429 }),
        ],
        { maxRetries: 2 },
      );

      const err = await client.get('clients').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ManagementApiError);
      expect((err as ManagementApiError).status).toBe(429);
      expect((err as ManagementApiError).path).toBe('oauth/token');
      expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 1000]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('drops the cached token and retries once on 401', async () => {
      const { client, fetchMock } = setup([
        tokenResponse('tok_old'),
        new Response('expired', { status: 401 }),
        tokenResponse('tok_new'),
        jsonResponse({ ok: true }),
      ]);

      await expect(client.get('clients')).resolves.toEqual({ ok: true });

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(headersOf(fetchMock.mock.calls[1][1]).authorization).toBe('Bearer tok_old');
      expect(headersOf(fetchMock.mock.calls[3][1]).authorization).toBe('Bearer tok_new');
    });

    it('does not retry a second 401', async () => {
      const { client, fetchMock } = setup([
        tokenResponse('tok_old'),
        new Response('nope', { status: 401 }),
        tokenResponse('tok_new'),
        new Response('nope', { status: 401 }),
      ]);

      const err = await client.get('clients').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ManagementApiError);
      expect((err as ManagementApiError).status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('transient failures', () => {
    const networkError = () => {
      throw new TypeError('fetch failed');
    };
    const timeoutError = () => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    };

    it('retries a network TypeError on GET, then succeeds', async () => {
      const { client, sleep, fetchMock } = setup([tokenResponse(), networkError, jsonResponse({ ok: true })]);

      await expect(client.get('clients')).resolves.toEqual({ ok: true });

      expect(sleep.mock.calls.map((c) => c[0])).toEqual([500]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('retries a TimeoutError DOMException on GET, then succeeds', async () => {
      const { client, sleep, fetchMock } = setup([tokenResponse(), timeoutError, jsonResponse({ ok: true })]);

      await expect(client.get('clients')).resolves.toEqual({ ok: true });

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('retries a 503 on GET, then succeeds', async () => {
      const cancelled = vi.fn();
      const { client, sleep, fetchMock } = setup([
        tokenResponse(),
        () => trackedResponse(503, cancelled),
        jsonResponse({ ok: true }),
      ]);

      await expect(client.get('clients')).resolves.toEqual({ ok: true });

      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(500);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('honors Retry-After on a 503', async () => {
      const { client, sleep } = setup([
        tokenResponse(),
        new Response('', { status: 503, headers: { 'retry-after': '3' } }),
        jsonResponse({}),
      ]);

      await client.get('clients');

      expect(sleep.mock.calls.map((c) => c[0])).toEqual([3000]);
    });

    it.each([
      ['put', 'PUT', 502],
      ['put', 'PUT', 504],
      ['delete', 'DELETE', 502],
      ['delete', 'DELETE', 504],
    ] as const)('retries a %s request on %i (%s)', async (fn, method, status) => {
      const { client, fetchMock } = setup([tokenResponse(), new Response('', { status }), jsonResponse({ ok: true })]);

      await expect(client[fn]('clients/abc', ...(fn === 'put' ? [{ x: 1 }] : [])) as Promise<unknown>).resolves.toEqual(
        {
          ok: true,
        },
      );

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[2][1]?.method).toBe(method);
    });

    it('retries a network error on PUT and DELETE', async () => {
      const put = setup([tokenResponse(), networkError, jsonResponse({})]);
      await put.client.put('clients/abc', { x: 1 });
      expect(put.fetchMock).toHaveBeenCalledTimes(3);

      const del = setup([tokenResponse(), networkError, new Response(null, { status: 204 })]);
      await del.client.delete('clients/abc');
      expect(del.fetchMock).toHaveBeenCalledTimes(3);
    });

    it.each([
      ['post', 503],
      ['patch', 503],
      ['post', 502],
      ['patch', 504],
    ] as const)('does not retry a %s request on %i', async (fn, status) => {
      const { client, sleep, fetchMock } = setup([tokenResponse(), new Response('down', { status }), jsonResponse({})]);

      const err = await client[fn]('clients', { x: 1 }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ManagementApiError);
      expect((err as ManagementApiError).status).toBe(status);
      expect(sleep).not.toHaveBeenCalled();
      // 1 token call + exactly 1 request call
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['post', networkError],
      ['patch', networkError],
      ['post', timeoutError],
      ['patch', timeoutError],
    ] as const)('does not retry a thrown error on %s', async (fn, thrower) => {
      const { client, sleep, fetchMock } = setup([tokenResponse(), thrower, jsonResponse({})]);

      await expect(client[fn]('clients', { x: 1 })).rejects.toThrow();

      expect(sleep).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('still retries a 429 on POST', async () => {
      const { client, sleep, fetchMock } = setup([
        tokenResponse(),
        new Response('', { status: 429, headers: { 'retry-after': '1' } }),
        jsonResponse({ id: 'x' }),
      ]);

      await expect(client.post('clients', { name: 'app' })).resolves.toEqual({ id: 'x' });

      expect(sleep).toHaveBeenCalledWith(1000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not retry a 500, even on GET', async () => {
      const { client, sleep, fetchMock } = setup([
        tokenResponse(),
        new Response('boom', { status: 500 }),
        jsonResponse({}),
      ]);

      const err = await client.get('clients').catch((e: unknown) => e);

      expect((err as ManagementApiError).status).toBe(500);
      expect(sleep).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry a thrown error that is not a network failure or timeout', async () => {
      const { client, sleep, fetchMock } = setup([
        tokenResponse(),
        () => {
          throw new SyntaxError('bad');
        },
        jsonResponse({}),
      ]);

      await expect(client.get('clients')).rejects.toBeInstanceOf(SyntaxError);

      expect(sleep).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('shares one retry budget across 429, 503 and network errors', async () => {
      const { client, sleep, fetchMock } = setup(
        [
          tokenResponse(),
          new Response('', { status: 429 }),
          new Response('', { status: 503 }),
          networkError,
          jsonResponse({ unreachable: true }),
        ],
        { maxRetries: 2 },
      );

      const err = await client.get('clients').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(TypeError);
      expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
      // 1 token call + maxRetries + 1 request calls
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('stops after the retry limit and throws the last status error', async () => {
      const { client, sleep, fetchMock } = setup(
        [
          tokenResponse(),
          new Response('a', { status: 503 }),
          new Response('b', { status: 502 }),
          new Response('c', { status: 504 }),
        ],
        { maxRetries: 2 },
      );

      const err = await client.get('clients').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ManagementApiError);
      expect((err as ManagementApiError).status).toBe(504);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('retries a network error from the token endpoint', async () => {
      const { client, sleep, fetchMock } = setup([networkError, tokenResponse(), jsonResponse({ ok: true })]);

      await expect(client.get('clients')).resolves.toEqual({ ok: true });

      expect(sleep.mock.calls.map((c) => c[0])).toEqual([500]);
      expect(String(fetchMock.mock.calls[1]![0])).toContain('/oauth/token');
    });

    it('retries a 503 from the token endpoint', async () => {
      const { client, sleep, fetchMock } = setup([
        new Response('', { status: 503, headers: { 'retry-after': '2' } }),
        tokenResponse(),
        jsonResponse({ ok: true }),
      ]);

      await expect(client.get('clients')).resolves.toEqual({ ok: true });

      expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not multiply a failing token fetch through the request loop', async () => {
      const { client, fetchMock } = setup(
        [
          new Response('', { status: 503 }),
          new Response('', { status: 503 }),
          new Response('', { status: 503 }),
          new Response('', { status: 503 }),
        ],
        { maxRetries: 2 },
      );

      const err = await client.get('clients').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ManagementApiError);
      expect((err as ManagementApiError).path).toBe('oauth/token');
      // maxRetries + 1 token calls, no request calls
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not multiply a failing token network error through the request loop', async () => {
      const { client, fetchMock } = setup([networkError, networkError, networkError, networkError], { maxRetries: 2 });

      await expect(client.get('clients')).rejects.toBeInstanceOf(TypeError);

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('handles a 401 refresh followed by a 503 within the budget', async () => {
      const { client, fetchMock } = setup([
        tokenResponse('tok_old'),
        new Response('expired', { status: 401 }),
        tokenResponse('tok_new'),
        new Response('', { status: 503 }),
        jsonResponse({ ok: true }),
      ]);

      await expect(client.get('clients')).resolves.toEqual({ ok: true });

      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(headersOf(fetchMock.mock.calls[4][1]).authorization).toBe('Bearer tok_new');
    });
  });

  describe('timeouts', () => {
    it('passes an AbortSignal to every token and API request', async () => {
      const { client, fetchMock } = setup([tokenResponse(), jsonResponse({}), jsonResponse({})]);

      await client.get('clients');
      await client.post('clients', { name: 'app' });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      for (const call of fetchMock.mock.calls) {
        expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
      }
    });

    it('rejects instead of hanging when the request exceeds timeoutMs', async () => {
      const fetchMock = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) return;
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      );
      const client = createManagementClient({
        domain: 'acme.auth0.com',
        clientId: 'client-id',
        clientSecret: SECRET,
        fetch: fetchMock as unknown as typeof fetch,
        sleep: async () => {},
        timeoutMs: 20,
      });

      await expect(client.get('clients')).rejects.toMatchObject({ name: 'TimeoutError' });
      // The token request hangs on every attempt: the initial call plus the default 3 retries.
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('errors', () => {
    it('includes status, method, and path, but never the secret or token', async () => {
      const { client } = setup([
        tokenResponse(),
        new Response(`bad request echoing ${SECRET} and ${TOKEN}`, { status: 400 }),
      ]);

      const err = await client.get('/clients/abc').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ManagementApiError);
      const apiErr = err as ManagementApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.method).toBe('GET');
      expect(apiErr.path).toBe('clients/abc');
      expect(apiErr.message).toContain('GET clients/abc');
      expect(apiErr.message).toContain('(400)');
      expect(apiErr.message).not.toContain(SECRET);
      expect(apiErr.message).not.toContain(TOKEN);
      expect(apiErr.body).not.toContain(SECRET);
      expect(apiErr.body).not.toContain(TOKEN);
    });

    it('truncates the body in the message to 500 characters', async () => {
      const { client } = setup([tokenResponse(), new Response('x'.repeat(2000), { status: 500 })]);

      const err = (await client.get('clients').catch((e: unknown) => e)) as ManagementApiError;

      expect(err.body).toHaveLength(2000);
      expect(err.message).toBe(`Management API GET clients failed (500): ${'x'.repeat(500)}`);
    });
  });
});
