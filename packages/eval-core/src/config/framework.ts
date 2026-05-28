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
  /** LLM API base URL. */
  baseUrl: string;
  /** API key for the proxy. Callers must supply this explicitly (e.g. from `LLM_API_KEY` env var). */
  apiKey?: string;
}

export interface AgentProxyConfig {
  /** Agent-specific proxy base URL. Overrides the top-level proxy.baseUrl for this agent. */
  baseUrl: string;
}

export interface AgentConfig {
  /** Agent-specific proxy settings. Falls back to top-level proxy if omitted. */
  proxy?: AgentProxyConfig;
}

export interface MCPStdioServerConfig {
  /** Command-based MCP server. */
  type: 'stdio';
  /** Executable command to start the MCP server. */
  command: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Environment variables injected into the server process. */
  env?: Record<string, string>;
}

export interface MCPHttpServerConfig {
  /** URL-based MCP server. */
  type: 'http';
  /** HTTP URL for the remote MCP server. */
  url: string;
}

/** Discriminated union — either a stdio (command-based) or http (URL-based) MCP server. */
export type MCPServerConfig = MCPStdioServerConfig | MCPHttpServerConfig;

export interface MCPConfig {
  /** Named MCP server definitions. Keys are server names. */
  servers: Record<string, MCPServerConfig>;
}

export interface RemoteSkillRepo {
  /** Git clone URL for the skills repository. */
  url: string;
  /** Branch to clone/fetch. Defaults to the remote's default branch (HEAD). */
  branch?: string;
  /** Local directory to clone into (relative to cwd). Defaults to `'skills-remote/<org>-<repo>'` derived from the repo URL. */
  localPath?: string;
  /** Subdirectory within the cloned repo that contains skill folders. Defaults to `'.'` (repo root). */
  skillsPath?: string;
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
}

export interface ModelsConfig {
  /** List of known working model identifiers. */
  known?: string[];
  /** Default model when none is specified via CLI. */
  default?: string;
  /** Maps short model aliases to full Bedrock model IDs. */
  bedrock?: Record<string, string>;
  /** Maps friendly model aliases to LiteLLM proxy model IDs. */
  litellm?: Record<string, string>;
}

export interface WorkspaceConfig {
  /** Directory names to exclude from file collection (e.g. node_modules, dist). */
  excludedDirs?: string[];
  /** Maximum number of files returned by collectFiles(). */
  maxListedFiles?: number;
  /** Prefix for temporary workspace directories. */
  tempDirPrefix?: string;
  /** Timeout (ms) for setup commands like `npm install`. */
  setupCommandTimeoutMs?: number;
}

export interface BraintrustConfig {
  /** Braintrust project ID for experiment tracking. */
  projectId?: string;
  /** Dataset name for eval sync. */
  datasetName?: string;
}

export interface ScoringConfig {
  /**
   * Allowed documentation URL sources as [hostname, pathname-prefix] pairs.
   * Replaces the framework default (Auth0 domains) when set.
   * Add extra entries to extend the list defined in `eval.config.js`.
   */
  docUrlSources?: readonly [string, string][];
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
  /** Workspace lifecycle settings (temp dirs, file collection, excluded dirs). */
  workspace?: WorkspaceConfig;
  /** Per-agent configuration overrides, keyed by runner ID. */
  agents?: Record<string, AgentConfig>;
  /** Braintrust experiment tracking settings. */
  braintrust?: BraintrustConfig;
  /** Scoring behaviour overrides (e.g. custom doc URL allowlist). */
  scoring?: ScoringConfig;
}
