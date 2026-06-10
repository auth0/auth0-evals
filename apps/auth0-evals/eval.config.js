// @ts-check
const remoteSkillsBranch = process.env.REMOTE_SKILLS_BRANCH || 'main';

// Base host of the LLM proxy that fronts the model providers, used by the agent
// runners below. Set via the LLM_PROXY_BASE_URL env var; unset by default, and
// required at runtime (the CLI fails fast if proxy.baseUrl is empty).
const PROXY_BASE_URL = process.env.LLM_PROXY_BASE_URL ?? '';

// Per-agent proxy overrides. Each falls back to the shared PROXY_BASE_URL when
// its agent-specific env var is unset.
const CLAUDE_PROXY_BASE_URL = process.env.CLAUDE_PROXY_BASE_URL ?? PROXY_BASE_URL;
const GEMINI_PROXY_BASE_URL = process.env.GEMINI_PROXY_BASE_URL ?? PROXY_BASE_URL;
const CODEX_PROXY_BASE_URL = process.env.CODEX_PROXY_BASE_URL ?? PROXY_BASE_URL;

/** @type {import('@a0/eval').FrameworkConfig} */
export default {
  evalsDir: 'src/evals',

  proxy: {
    baseUrl: PROXY_BASE_URL,
  },

  agents: {
    'claude-code': {
      proxy: {
        baseUrl: CLAUDE_PROXY_BASE_URL,
      },
    },
    'gemini-cli': {
      proxy: { baseUrl: GEMINI_PROXY_BASE_URL },
    },
    'codex': {
      proxy: { baseUrl: CODEX_PROXY_BASE_URL },
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
        branch: remoteSkillsBranch,
        localPath: 'skills-remote/auth0-skills',
        skillsPath: 'plugins/auth0/skills',
      },
    ],
    localDirs: ['skills'],
  },

  judge: {
    model: 'claude-opus-4-8',
    maxTokens: 1024,
    maxCodeChars: 32_768,
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
    known: ['gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-fable-5', 'claude-haiku-4-5', 'gemini-3.1-pro-preview', 'gemini-3.5-flash'],
    default: 'gpt-5.4',
    // Maps short model aliases to the IDs the active proxy expects.
    // Bedrock proxy needs full `global.anthropic.*` IDs; LiteLLM proxy serves
    // models under the alias itself, so the map is empty and aliases pass through.
    modelIds: useBedrock
      ? {
          'claude-sonnet-4-6': 'global.anthropic.claude-sonnet-4-6',
          'claude-opus-4-6': 'global.anthropic.claude-opus-4-6-v1',
          'claude-opus-4-7': 'global.anthropic.claude-opus-4-7',
          'claude-opus-4-8': 'global.anthropic.claude-opus-4-8',
          'claude-fable-5': 'global.anthropic.claude-fable-5',
          'claude-opus-4-5': 'global.anthropic.claude-opus-4-5-20251101-v1:0',
          'claude-haiku-4-5': 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        }
      : {},
  },
};
