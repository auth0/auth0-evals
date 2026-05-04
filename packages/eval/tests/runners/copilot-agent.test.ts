/**
 * Unit tests for the Copilot SDK agent runner.
 *
 * Tests the exported helpers and constants that remain unit-testable
 * without spawning the actual Copilot CLI.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { setFrameworkConfig } from '../../src/config/framework-config.js';
import type { FrameworkConfig } from '../../src/config/framework.js';

const TEST_CONFIG: Required<FrameworkConfig> = {
  evalsDir: 'src/evals',
  proxy: { baseUrl: '<LLM_PROXY_URL>/v1' },
  mcp: {
    servers: {
      'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
    },
  },
  skills: {
    remoteRepos: [
      {
        url: 'https://github.com/auth0/agent-skills.git',
        localPath: 'skills-remote/auth0-skills',
        skillsPath: 'plugins/auth0/skills',
      },
    ],
    localDirs: ['skills'],
  },
  judge: {
    model: 'claude-sonnet-4-5',
    maxTokens: 1024,
    maxCodeChars: 16_384,
    promptsDir: 'src/prompts/judge',
  },
  models: {
    known: ['gpt-5.4', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'gemini-3.1-pro-preview'],
    default: 'gpt-5.4',
    bedrock: {
      'claude-sonnet-4-6': 'global.anthropic.claude-sonnet-4-6',
      'claude-opus-4-6': 'global.anthropic.claude-opus-4-6-v1',
      'claude-sonnet-4-5': 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'claude-opus-4-7': 'global.anthropic.claude-opus-4-7',
      'claude-opus-4-5': 'global.anthropic.claude-opus-4-5-20251101-v1:0',
    },
    litellm: {
      'claude-sonnet-4-6': '_claude-sonnet-4-6',
      'claude-opus-4-6': '_claude-opus-4-6',
      'claude-opus-4-7': '_claude-opus-4-7',
      'claude-sonnet-4-5': '_claude-sonnet-4-5',
      'claude-opus-4-5': '_claude-opus-4-5',
    },
  },
};

beforeAll(() => {
  setFrameworkConfig(TEST_CONFIG);
});

import { COPILOT_MODEL_ID, getMcpServers } from '../../src/runners/copilot/agent.js';

describe('COPILOT_MODEL_ID', () => {
  it('is the expected sentinel value', () => {
    expect(COPILOT_MODEL_ID).toBe('copilot');
  });
});

describe('getMcpServers', () => {
  it('returns auth0-docs remote MCP server config', () => {
    const servers = getMcpServers();
    expect(servers).toHaveProperty('auth0-docs');
    expect(servers['auth0-docs'].type).toBe('http');
    expect(servers['auth0-docs'].url).toBe('https://auth0.com/docs/mcp');
  });

  it('includes all tools via wildcard', () => {
    const servers = getMcpServers();
    expect(servers['auth0-docs'].tools).toContain('*');
  });
});
