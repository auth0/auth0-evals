/**
 * Runtime singleton for the loaded FrameworkConfig.
 *
 * Set once at startup in `main()` after `loadConfig()` resolves.
 * Every module that needs config values calls `getFrameworkConfig()`
 * instead of importing hardcoded constants.
 */

import type { FrameworkConfig } from '@a0/eval';

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
