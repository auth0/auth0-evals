/**
 * Unit tests for the Copilot SDK agent runner.
 *
 * Tests the exported helpers and constants that remain unit-testable
 * without spawning the actual Copilot CLI.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { setFrameworkConfig } from '@a0/eval-core';
import type { FrameworkConfig } from '@a0/eval-core';

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
import { CopilotCliTranslator } from '../../src/runners/copilot/translator.js';

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

describe('CopilotCliTranslator', () => {
  const translator = new CopilotCliTranslator();

  it.each([
    ['bash', 'run_command'],
    ['read_bash', 'run_command'],
    ['view', 'read_file'],
    ['read', 'read_file'],
    ['write', 'write_file'],
    ['create', 'write_file'],
    ['edit', 'write_file'],
    ['apply_patch', 'write_file'],
    ['glob', 'list_files'],
    ['grep', 'list_files'],
    ['web_fetch', 'fetch_url'],
    ['web_search', 'fetch_url'],
    ['ask_user', 'ask_user'],
  ])('maps %s -> %s', (copilotName, expected) => {
    expect(translator.mapName(copilotName)).toBe(expected);
  });

  it('preserves MCP tool names in legacy and hyphen formats', () => {
    expect(translator.mapName('mcp__auth0-docs__search_auth0_docs')).toBe('mcp__auth0-docs__search_auth0_docs');
    expect(translator.mapName('auth0-docs-search_auth0_docs')).toBe('auth0-docs-search_auth0_docs');
  });

  it('does not map prototype keys from Object inheritance chain', () => {
    expect(translator.mapName('toString')).toBe('tostring');
    expect(translator.mapName('constructor')).toBe('constructor');
  });

  it('classifies doc lookups for web and mcp tools', () => {
    expect(translator.isDocLookup('web_fetch')).toBe(true);
    expect(translator.isDocLookup('web_search')).toBe(true);
    expect(translator.isDocLookup('auth0-docs-search_auth0_docs')).toBe(true);
    expect(translator.isDocLookup('bash')).toBe(false);
  });

  it('classifies interruptions and internal tools', () => {
    expect(translator.isInterruption('ask_user')).toBe(true);
    expect(translator.isInterruption('view')).toBe(false);
    expect(translator.isInternalTool('report_intent')).toBe(true);
    expect(translator.isInternalTool('skill')).toBe(true);
    expect(translator.isInternalTool('view')).toBe(false);
  });
});
