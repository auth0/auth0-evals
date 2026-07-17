/**
 * Shared test config object — values matching eval.config.js.
 *
 * Used by setup-config.ts (singleton initialisation) and vi.mock factories
 * (for tests that use vi.resetModules() and need the mock to survive re-imports).
 */

import type { FrameworkConfig } from '@a0/evals-core';

export const TEST_CONFIG: Required<FrameworkConfig> = {
  evalsDir: 'src/evals',
  proxy: { baseUrl: 'https://llm.example.com/v1' },
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
    model: 'claude-opus-4-7',
    maxTokens: 1024,
    maxCodeChars: 16_384,
  },
  models: {
    known: [
      'gpt-5.4',
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-haiku-4-5',
      'gemini-3.1-pro-preview',
    ],
    default: 'gpt-5.4',
    modelIds: {},
  },
};
