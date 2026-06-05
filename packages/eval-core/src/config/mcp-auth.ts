/**
 * OAuth token minting for authenticated HTTP MCP servers.
 *
 * Performs a client-credentials exchange to obtain a short-lived Bearer token.
 * Called once per agent job so a long matrix run never reuses an expired token.
 */

import type { MCPOAuthConfig } from './framework.js';
import { logger } from '../utils/logger.js';

export async function mintMcpToken(auth: MCPOAuthConfig): Promise<string | undefined> {
  if (!auth.tokenUrl || !auth.clientId || !auth.clientSecret || !auth.audience) {
    logger.warn('[mcp-auth] Incomplete OAuth config — skipping token mint');
    return undefined;
  }
  try {
    const res = await fetch(auth.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        audience: auth.audience,
      }),
    });
    if (!res.ok) {
      logger.warn(`[mcp-auth] Token request failed: ${res.status}`);
      return undefined;
    }
    const { access_token } = (await res.json()) as { access_token?: string };
    if (!access_token) {
      logger.warn('[mcp-auth] Token response missing access_token');
      return undefined;
    }
    return access_token;
  } catch (err) {
    logger.warn(`[mcp-auth] Token request error: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
