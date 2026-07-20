/**
 * OAuth token minting for authenticated HTTP MCP servers.
 *
 * Performs a client-credentials exchange to obtain a short-lived Bearer token.
 * Called once per agent job so a long matrix run never reuses an expired token.
 */

import type { MCPOAuthConfig } from './framework.js';
import { logger } from '../utils/logger.js';

/** Fail-fast budget for the token endpoint — a hung endpoint must not block job startup. */
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Derives the environment-variable name a runner uses to pass a minted Bearer
 * token to an MCP server, keeping the secret out of on-disk config files.
 * Runners reference this name indirectly — Codex via `bearer_token_env_var` in
 * config.toml, Gemini CLI via `$VAR` expansion in settings.json.
 *
 * Assumes server names are distinct after normalization: uppercasing and
 * mapping non-alphanumerics to `_` means names like `auth0-hosted` and
 * `auth0.hosted` would collide to the same env var. Config keys are authored by
 * hand and never differ only by punctuation, so this holds.
 */
export function mcpBearerTokenEnvVar(serverName: string): string {
  return `MCP_BEARER_${serverName.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
}

export async function mintMcpToken(auth: MCPOAuthConfig): Promise<string | undefined> {
  if (!auth.tokenUrl || !auth.clientId || !auth.clientSecret || !auth.audience) {
    logger.warn('[mcp-auth] Incomplete OAuth config — skipping token mint');
    return undefined;
  }
  try {
    // Form-encode the request: RFC 6749 §4.4.2 mandates
    // application/x-www-form-urlencoded for the client-credentials grant, so
    // this is the most broadly compatible format for an arbitrary protected
    // MCP server's token endpoint. Auth0's /oauth/token accepts it too.
    const res = await fetch(auth.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        audience: auth.audience,
      }),
      // Fail fast: a token endpoint that accepts the connection but never
      // responds would otherwise block job startup until the 30-min task
      // timeout. AbortSignal.timeout rejects the fetch after 10s instead.
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
    // Read the raw body once so it's preserved for diagnosis whether the
    // status is an error OR a 200 with a non-JSON payload (e.g. a proxy/gateway
    // HTML error page) — res.json() would consume it and leave nothing to log.
    const body = await res.text().catch(() => '');
    if (!res.ok) {
      // For the documented access_denied case the body carries the
      // error/error_description, making misconfig far easier to diagnose.
      logger.warn(`[mcp-auth] Token request failed: ${res.status}${body ? ` — ${body}` : ''}`);
      return undefined;
    }
    let access_token: string | undefined;
    try {
      ({ access_token } = JSON.parse(body) as { access_token?: string });
    } catch {
      logger.warn(`[mcp-auth] Token response was not valid JSON${body ? ` — ${body}` : ''}`);
      return undefined;
    }
    if (!access_token) {
      logger.warn('[mcp-auth] Token response missing access_token');
      return undefined;
    }
    return access_token;
  } catch (err) {
    // Include the token endpoint so a DNS/TLS/network failure is
    // distinguishable from a misconfigured URL.
    logger.warn(
      `[mcp-auth] Token request error for ${auth.tokenUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}
