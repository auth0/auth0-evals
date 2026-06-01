import type { FrameworkConfig } from './framework.js';

/**
 * Sensible generic defaults for every optional field.
 *
 * Auth0-specific values (proxy URL, model registry, MCP servers, skills repos)
 * belong in the consumer's `eval.config.js`, not here. These defaults are the
 * bare minimum so the framework can function without any config file.
 */
export const DEFAULT_FRAMEWORK_CONFIG: Required<FrameworkConfig> = {
  evalsDir: 'src/evals',

  proxy: {
    baseUrl: '',
  },

  mcp: {
    servers: {},
  },

  skills: {
    remoteRepos: [],
    localDirs: ['skills'],
  },

  judge: {
    model: '',
    maxTokens: 1024,
    maxCodeChars: 32_768,
  },

  workspace: {
    excludedDirs: ['node_modules', '.git', 'dist', '.next', '.nuxt', '__pycache__', '.venv', 'venv', '.build'],
    maxListedFiles: 200,
    tempDirPrefix: 'auth0_eval_',
    setupCommandTimeoutMs: 300_000,
  },

  models: {
    known: [],
    default: '',
    bedrock: {},
    litellm: {},
  },

  agents: {},

  braintrust: {
    projectId: '',
    datasetName: '',
  },

  scoring: {},
};
