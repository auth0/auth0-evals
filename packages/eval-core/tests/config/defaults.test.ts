/**
 * Tests for src/config/defaults.ts — ensures defaults are generic (no Auth0-specific values).
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_FRAMEWORK_CONFIG } from '../../src/config/defaults.js';

describe('DEFAULT_FRAMEWORK_CONFIG', () => {
  it('has evalsDir set to src/evals', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.evalsDir).toBe('src/evals');
  });

  it('has empty proxy.baseUrl', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.proxy.baseUrl).toBe('');
  });

  it('has generic judge defaults', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.judge.model).toBe('');
    expect(DEFAULT_FRAMEWORK_CONFIG.judge.maxTokens).toBe(1024);
    expect(DEFAULT_FRAMEWORK_CONFIG.judge.maxCodeChars).toBe(16_384);
  });

  it('has empty models.default', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.models.default).toBe('');
  });

  it('has empty known models', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.models.known).toEqual([]);
  });

  it('has empty bedrock mappings', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.models.bedrock).toEqual({});
  });

  it('has empty litellm mappings', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.models.litellm).toEqual({});
  });

  it('has empty mcp.servers by default', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.mcp.servers).toEqual({});
  });

  it('has empty skills.remoteRepos and default localDirs', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.skills.remoteRepos).toEqual([]);
    expect(DEFAULT_FRAMEWORK_CONFIG.skills.localDirs).toEqual(['skills']);
  });
});
