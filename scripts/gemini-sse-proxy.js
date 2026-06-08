#!/usr/bin/env node

/**
 * Standalone SSE-unwrapping proxy for the Gemini CLI runner.
 *
 * Works around a LiteLLM proxy bug (v1.86.0+) where streamGenerateContent
 * responses are double-wrapped in SSE format. This proxy reassembles the
 * fragmented payload and forwards clean events.
 *
 * Usage:
 *   node scripts/gemini-sse-proxy.js [--port 9876]
 *
 * Options:
 *   --port <port>  Port to listen on (default: 9876)
 */

import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { parseArgs } from 'node:util';

const UPSTREAM_URL = process.env.LLM_PROXY_BASE_URL || 'https://your-llm-proxy.example.com';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '9876' },
  },
});

const upstream = new URL(UPSTREAM_URL);
const port = parseInt(values.port, 10);

/**
 * Split a concatenated sequence of JSON objects into individual objects.
 * Uses brace counting to find object boundaries, skipping string literals.
 */
function splitJsonObjects(input) {
  const results = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(input.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
}

/**
 * Reassemble a complete response from LiteLLM's broken SSE wrapping.
 *
 * Strategy: find all `data:` lines (at line start), strip prefixes, and
 * group them into valid JSON objects. Each complete JSON object becomes
 * one output SSE event.
 */
function reassembleResponse(raw) {
  const lines = raw.split('\n');
  const dataValues = [];

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith('data: data: ')) {
      dataValues.push(line.slice(12));
    } else if (line.startsWith('data: ')) {
      const value = line.slice(6);
      if (value === '[DONE]') continue;
      dataValues.push(value);
    }
  }

  const combined = dataValues.join('');
  const events = splitJsonObjects(combined);

  return events.map((json) => 'data: ' + json + '\r\n\r\n').join('');
}

const server = createServer((req, res) => {
  const isStream = req.url?.includes(':streamGenerateContent') ?? false;

  const opts = {
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: upstream.host },
  };

  const transport = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
  const proxyReq = transport(opts, (proxyRes) => {
    const statusCode = proxyRes.statusCode ?? 200;
    if (!isStream || statusCode >= 400) {
      res.writeHead(statusCode, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    const headers = { ...proxyRes.headers };
    delete headers['content-length'];
    headers['transfer-encoding'] = 'chunked';
    res.writeHead(statusCode, headers);

    const bodyChunks = [];
    proxyRes.setEncoding('utf-8');
    proxyRes.on('data', (chunk) => bodyChunks.push(chunk));
    proxyRes.on('end', () => {
      const body = bodyChunks.join('');
      const output = reassembleResponse(body);
      res.write(output);
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[GeminiProxy] upstream error: ${err.message}`);
    if (!res.headersSent) res.writeHead(502);
    res.end(`proxy error: ${err.message}`);
  });

  req.pipe(proxyReq);
});

server.listen(port, '127.0.0.1', () => {
  const addr = server.address();
  const listenUrl = `http://127.0.0.1:${addr.port}`;
  console.log(`[GeminiProxy] Listening on ${listenUrl} → ${UPSTREAM_URL}`);
});
