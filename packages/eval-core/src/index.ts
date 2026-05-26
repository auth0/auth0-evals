/**
 * @a0/eval-core — Core evaluation framework types, errors, and utilities.
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
  TurnMetric,
  FinishReason,
  ActionType,
  DimensionScore,
  ScoredResult,
  ScoringOptions,
  DimensionWeights,
} from './types/scorer.js';

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
export { estimateCost } from './config/costs.js';

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
  BraintrustConfig,
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

// Types — eval definition
export type { EvalDefinition, GraderDef } from './types/eval.js';

// Loader
export { loadEval } from './loader.js';
export type { EvalConfig, LoadEvalOptions } from './loader.js';

// Discovery
export { discoverEvals } from './discovery.js';

// Serializers
export {
  formatStep,
  serialiseTrace,
  serialiseTurnMetrics,
  serialiseBaseline,
  serialiseAgent,
  serialiseError,
} from './serializers.js';
export type { BaselineResult } from './serializers.js';

// Framework config singleton
export { getFrameworkConfig, setFrameworkConfig, getAgentProxyBaseUrl } from './config/framework-config.js';

// Settings
export {
  MAX_TURNS,
  CLAUDE_EFFORT_MODELS,
  getLitellmModelMap,
  getLitellmModelReverseMap,
  CLAUDE_CODE_TASK_TIMEOUT_MS,
  COPILOT_TASK_TIMEOUT_MS,
  BASELINE_TASK_TIMEOUT_MS,
  CODEX_TASK_TIMEOUT_MS,
} from './config/settings.js';

// Session
export { makeSessionId } from './utils/session.js';

// Env filtering
export { filteredEnv } from './utils/env.js';

// Model detection
export { isBedrockModel, isClaudeModel, isGeminiModel, isGptModel } from './config/model-detect.js';

// Grader engine
export {
  runGraders,
  llmJudge,
  passRate,
  collectGraderFiles,
  gradeText,
  BASELINE_LEVELS,
  AGENT_LEVELS,
  AGENT_MCP_LEVELS,
  registerExecutor,
  getExecutor,
  executeGrader,
} from './graders/index.js';

export type { GraderContext, GraderExecutor } from './graders/index.js';

// Mode
export { ALL_MODES } from './types/mode.js';
export type { Mode } from './types/mode.js';

// Runner infrastructure
export type { AgentRunner, RunParams, RunResult } from './runners/agent-runner.js';
export { registerRunner, getRunner } from './runners/agent-runner.js';
export type { ToolTranslator } from './runners/tool-translator.js';
export { classifyActionType, primaryArg, detectRetry, classifyErrorCategory } from './runners/classify.js';
export type { SkillsStrategy } from './runners/skills/strategy.js';
export { copySkillsToWorkspace, CopySkillsStrategy } from './runners/skills/strategy.js';
export { SkillsManager, getSkillsManager, resetSkillsManager } from './runners/skills/config.js';

// Recommendations types
export type { Recommendation, Recommendations } from './recommendations/types.js';
