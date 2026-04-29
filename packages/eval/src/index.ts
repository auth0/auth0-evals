/**
 * @a0/eval — Core evaluation framework types, errors, and utilities.
 */

// Types — agents & traces
export type { AgentType, ErrorCategory, TraceStep, TurnMetricEntry } from './types/agents.js';
export { KNOWN_AGENT_TYPES } from './types/agents.js';

// Types — graders
export { GraderLevel } from './types/graders.js';

// Types — scorer
export type {
  GraderResult,
  RunRecord,
  ToolCallRecord,
  DimensionScore,
  ScoredResult,
  ScoringOptions,
  DimensionWeights,
} from './types/scorer.js';

// Scorer
export { score, scoreToGrade } from './scorer.js';

// Types — results
export type {
  JobResult,
  BaselineJobResult,
  AgentJobResult,
  ErrorJobResult,
  GraderSummary,
  DimensionSummary,
} from './types/results.js';

// Errors
export {
  EvalFrameworkError,
  EvalNotFoundError,
  UnknownModeError,
  LlmApiError,
  EvalConfigError,
  JudgeError,
  BedrockToolConfigError,
} from './errors.js';

// Logger
export { logger, setLogger } from './utils/logger.js';
export type { Logger } from './utils/logger.js';

// Retry
export { withRetry, isTransientLlmError } from './utils/retry.js';
export type { RetryOptions } from './utils/retry.js';

// Costs
export { COST_TABLE, estimateCost } from './config/costs.js';

// Framework config
export type {
  FrameworkConfig,
  ProxyConfig,
  MCPConfig,
  MCPServerConfig,
  MCPStdioServerConfig,
  MCPHttpServerConfig,
  SkillsConfig,
  RemoteSkillRepo,
  JudgeConfig,
  ModelsConfig,
  WorkspaceConfig,
} from './config/framework.js';
export { DEFAULT_FRAMEWORK_CONFIG } from './config/defaults.js';
export { defineConfig, loadConfig, deepMerge } from './config/loader.js';
export type { LoadConfigOptions } from './config/loader.js';

// Workspace
export {
  setupWorkspace,
  runSetupCommand,
  cleanupWorkspace,
  collectFiles,
  isPathInside,
  resolveInside,
  validatePathFormat,
} from './workspace/index.js';
export type { SetupWorkspaceOptions, RunSetupCommandOptions, CollectFilesOptions } from './workspace/index.js';
