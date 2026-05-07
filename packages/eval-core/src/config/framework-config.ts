/**
 * Runtime singleton for the loaded FrameworkConfig.
 *
 * Set once at startup in `main()` after `loadConfig()` resolves.
 * Every module that needs config values calls `getFrameworkConfig()`
 * instead of importing hardcoded constants.
 */

import type { FrameworkConfig } from './framework.js';

let _config: Required<FrameworkConfig> | null = null;

export function setFrameworkConfig(config: Required<FrameworkConfig>): void {
  _config = config;
}

export function getFrameworkConfig(): Required<FrameworkConfig> {
  if (!_config) {
    throw new Error('FrameworkConfig not initialized. Call setFrameworkConfig() first.');
  }
  return _config;
}

/**
 * Resolve the proxy base URL for a given agent runner.
 * Returns `agents.<agentId>.proxy.baseUrl` if configured, otherwise falls back to `proxy.baseUrl`.
 */
export function getAgentProxyBaseUrl(agentId: string): string {
  const config = getFrameworkConfig();
  return config.agents?.[agentId]?.proxy?.baseUrl ?? config.proxy.baseUrl;
}
