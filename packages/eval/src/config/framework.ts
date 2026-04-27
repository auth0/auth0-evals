/**
 * FrameworkConfig — the single configuration surface for the eval framework.
 *
 * Consumers define an `eval.config.js` that default-exports a
 * `Partial<FrameworkConfig>` (via {@link defineConfig} for autocomplete).
 * The loader merges it with {@link DEFAULT_FRAMEWORK_CONFIG} so every
 * optional field has a sensible fallback.
 */

// ── Sub-configs ──────────────────────────────────────────────────────────────

export interface ProxyConfig {
  /** LLM API base URL (e.g. `https://llm.atko.ai/v1`). */
  baseUrl: string;
  /** API key for the proxy. Falls back to `ATKO_API_KEY` env var when omitted. */
  apiKey?: string;
}

export interface MCPServerConfig {
  /** Executable command to start the MCP server. */
  command: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Environment variables injected into the server process. */
  env?: Record<string, string>;
}

export interface MCPConfig {
  /** Named MCP server definitions. Keys are server names. */
  servers: Record<string, MCPServerConfig>;
}

export interface RemoteSkillRepo {
  /** Git clone URL for the skills repository. */
  url: string;
  /** Local directory to clone into (relative to cwd). */
  localPath?: string;
}

export interface SkillsConfig {
  /** Remote skill repositories to clone. */
  remoteRepos?: RemoteSkillRepo[];
  /** Local directories containing skill files. */
  localDirs?: string[];
}

export interface JudgeConfig {
  /** Model used for LLM-as-judge grading. */
  model?: string;
  /** Maximum tokens for judge responses. */
  maxTokens?: number;
  /** Maximum characters of combined source code sent to the judge. */
  maxCodeChars?: number;
  /** Directory containing custom judge prompts. */
  promptsDir?: string;
}

export interface ModelsConfig {
  /** List of known working model identifiers. */
  known?: string[];
  /** Default model when none is specified via CLI. */
  default?: string;
  /** Maps short model aliases to full Bedrock model IDs. */
  bedrock?: Record<string, string>;
}

// ── Root config ──────────────────────────────────────────────────────────────

export interface FrameworkConfig {
  /** Directory containing evaluation definitions (required). */
  evalsDir: string;
  /** LLM proxy configuration. */
  proxy?: ProxyConfig;
  /** MCP server definitions for agent+mcp configurations. */
  mcp?: MCPConfig;
  /** Skill file sources (remote repos and local directories). */
  skills?: SkillsConfig;
  /** LLM-as-judge settings. */
  judge?: JudgeConfig;
  /** Model registry and defaults. */
  models?: ModelsConfig;
}
