/**
 * Tests for src/config/defaults.ts — ensures defaults match current hardcoded values.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_FRAMEWORK_CONFIG } from '../../src/config/defaults.js';

describe('DEFAULT_FRAMEWORK_CONFIG', () => {
  it('has evalsDir set to src/evals', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.evalsDir).toBe('src/evals');
  });

  it('has proxy.baseUrl matching settings.ts BASE_URL', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.proxy.baseUrl).toBe('<LLM_PROXY_URL>/v1');
  });

  it('has judge defaults matching settings.ts', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.judge.model).toBe('claude-4-5-sonnet');
    expect(DEFAULT_FRAMEWORK_CONFIG.judge.maxTokens).toBe(1024);
    expect(DEFAULT_FRAMEWORK_CONFIG.judge.maxCodeChars).toBe(16_384);
  });

  it('has models.default matching constants.ts DEFAULT_MODEL', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.models.default).toBe('gpt-5.4');
  });

  it('has known models matching constants.ts KNOWN_WORKING_MODELS', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.models.known).toEqual([
      'gpt-5.4',
      'claude-4-6-sonnet',
      'claude-4-6-opus',
      'claude-opus-4-7',
      'gemini-3.1-pro-preview',
    ]);
  });

  it('has bedrock mappings matching claude-code/agent.ts BEDROCK_MODEL_ALIAS_MAP', () => {
    const bedrock = DEFAULT_FRAMEWORK_CONFIG.models.bedrock;
    expect(bedrock['claude-4-6-sonnet']).toBe('global.anthropic.claude-sonnet-4-6');
    expect(bedrock['claude-4-6-opus']).toBe('global.anthropic.claude-opus-4-6-v1');
    expect(bedrock['claude-opus-4-7']).toBe('global.anthropic.claude-opus-4-7');
  });

  it('has empty mcp.servers by default', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.mcp.servers).toEqual({});
  });

  it('has skills with remote repo and local dir', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.skills.remoteRepos).toHaveLength(1);
    expect(DEFAULT_FRAMEWORK_CONFIG.skills.remoteRepos![0].url).toContain('auth0-skills');
    expect(DEFAULT_FRAMEWORK_CONFIG.skills.localDirs).toEqual(['skills']);
  });
});
