// @ts-check
const useBedrock = process.env.CLAUDE_CODE_USE_BEDROCK_PROXY === '1';

/** @type {import('@a0/eval').FrameworkConfig} */
export default {
  evalsDir: 'src/evals',

  proxy: {
    baseUrl: 'https://llm.atko.ai/v1',
  },

  agents: {
    'claude-code': {
      proxy: { baseUrl: useBedrock ? 'https://llm.atko.ai/anthropic' : 'https://llm.atko.ai' },
    },
    'gemini-cli': {
      proxy: { baseUrl: 'https://llm.atko.ai' },
    },
    'codex': {
      proxy: { baseUrl: 'https://llm.atko.ai' },
    },
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
    model: 'claude-opus-4-7',
    maxTokens: 1024,
    maxCodeChars: 16_384,
  },

  scoring: {
    // Add [hostname, pathname-prefix] pairs to extend the allowlist.
    docUrlSources: [
      ['auth0.github.io', '/'],
      ['auth0.com', '/docs'],
      ['auth0.com', '/blog'],
      ['community.auth0.com', '/'],
      ['npmjs.com', '/package/@auth0'],
      ['github.com', '/auth0/'],
      ['github.com', '/auth0-samples'],
      ['jwt.io', '/'],
      // ['developer.okta.com', '/docs'],
    ],
  },


  braintrust: {
    projectId: '38395851-dd41-46ec-a971-a30402db6921',
    datasetName: 'auth0-evals',
  },

  models: {
    known: ['gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-haiku-4-5', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview'],
    default: 'gpt-5.4',
    bedrock: {
      'claude-sonnet-4-6': 'global.anthropic.claude-sonnet-4-6',
      'claude-opus-4-6': 'global.anthropic.claude-opus-4-6-v1',
      'claude-opus-4-7': 'global.anthropic.claude-opus-4-7',
      'claude-opus-4-5': 'global.anthropic.claude-opus-4-5-20251101-v1:0',
      'claude-haiku-4-5': 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    },
    litellm: {
      'claude-sonnet-4-6': '_claude-sonnet-4-6',
      'claude-opus-4-6': '_claude-opus-4-6',
      'claude-opus-4-7': '_claude-opus-4-7',
      'claude-opus-4-5': '_claude-opus-4-5',
      'claude-haiku-4-5': 'claude-haiku-4-5',
    },
  },
};
