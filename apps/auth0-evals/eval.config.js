// @ts-check
/** @type {import('@a0/eval').FrameworkConfig} */
export default {
  evalsDir: 'src/evals',

  proxy: {
    baseUrl: '<LLM_PROXY_URL>/v1',
  },

  mcp: {
    servers: {
      'auth0-docs': {
        type: 'http',
        url: 'https://auth0.com/docs/mcp',
      },
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
