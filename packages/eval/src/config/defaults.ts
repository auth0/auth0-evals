import type { FrameworkConfig } from './framework.js';

/**
 * Sensible defaults for every optional field.
 *
 * Values mirror the hardcoded constants used in `apps/auth0-evals`.
 */
export const DEFAULT_FRAMEWORK_CONFIG: Required<FrameworkConfig> = {
  evalsDir: 'src/evals',

  proxy: {
    baseUrl: 'https://llm.atko.ai/v1',
  },

  mcp: {
    servers: {},
  },

  skills: {
    remoteRepos: [
      {
        url: 'https://github.com/auth0/auth0-skills.git',
        localPath: 'skills-remote',
      },
    ],
    localDirs: ['skills'],
  },

  judge: {
    model: 'claude-4-5-sonnet',
    maxTokens: 1024,
    maxCodeChars: 16_384,
  },

  models: {
    known: ['gpt-5.4', 'claude-4-6-sonnet', 'claude-4-6-opus', 'claude-opus-4-7', 'gemini-3.1-pro-preview'],
    default: 'gpt-5.4',
    bedrock: {
      'claude-4-6-sonnet': 'global.anthropic.claude-sonnet-4-6',
      'claude-4-6-opus': 'global.anthropic.claude-opus-4-6-v1',
      'claude-4-5-sonnet': 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'claude-opus-4-7': 'global.anthropic.claude-opus-4-7',
      'claude-4-5-opus': 'global.anthropic.claude-opus-4-5-20251101-v1:0',
      'claude-4-5-haiku': 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    },
  },
};
