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
  TurnMetric,
  FinishReason,
  ActionType,
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

// Types — eval definition
export type { EvalDefinition, GraderDef } from './types/eval.js';

// Loader
export { loadEval } from './loader.js';
export type { EvalConfig, LoadEvalOptions } from './loader.js';

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
export { getFrameworkConfig, setFrameworkConfig } from './config/framework-config.js';

// Settings
export {
  MAX_TURNS,
  BEDROCK_MODELS,
  CLAUDE_EFFORT_MODELS,
  GEMINI_MODELS,
  GPT_MODELS,
  getLitellmModelMap,
  getLitellmModelReverseMap,
  CLAUDE_CODE_TASK_TIMEOUT_MS,
  COPILOT_TASK_TIMEOUT_MS,
} from './config/settings.js';

// Session
export { makeSessionId } from './utils/session.js';

// Env filtering
export { filteredEnv } from './utils/env.js';

// Model detection
export { isBedrockModel, isClaudeModel, isGeminiModel, isGptModel } from './config/model-detect.js';

// Runner infrastructure
export type { AgentRunner, RunParams, RunResult } from './runners/agent-runner.js';
export { registerRunner, getRunner } from './runners/agent-runner.js';
export type { ToolTranslator } from './runners/tool-translator.js';
export { BaseToolTranslator } from './runners/base-translator.js';
export { classifyActionType, primaryArg, detectRetry, classifyErrorCategory } from './runners/classify.js';
export type { SkillsStrategy } from './runners/skills/strategy.js';
export {
  ensureCloned,
  copySkillsToWorkspace,
  augmentWithSkills,
  InjectSkillsStrategy,
  CopySkillsStrategy,
} from './runners/skills/strategy.js';
export { getSkillsDirs, resolveSkillDir } from './runners/skills/config.js';

// Copilot runner
export { CopilotCliRunner } from './runners/copilot/runner.js';
export { CopilotCliTranslator } from './runners/copilot/translator.js';
export { runCopilotAgent, getMcpServers, COPILOT_MODEL_ID, COPILOT_DEFAULT_MODEL } from './runners/copilot/agent.js';
export type { CopilotRunOptions } from './runners/copilot/agent.js';

// Runner — Gemini CLI
export { GeminiCliRunner } from './runners/gemini-cli/runner.js';
export { runGeminiCliAgent, GEMINI_CLI_MODEL_ID, GEMINI_CLI_DEFAULT_MODEL } from './runners/gemini-cli/agent.js';
export type { GeminiCliRunOptions } from './runners/gemini-cli/agent.js';
export { GeminiCliTranslator } from './runners/gemini-cli/translator.js';

// Claude Code runner
export { ClaudeCodeRunner } from './runners/claude-code/runner.js';
export { ClaudeCodeTranslator } from './runners/claude-code/translator.js';
export {
  runClaudeCodeAgent,
  writeAgentSystemPrompt,
  handleMessage,
  normaliseStopReason,
  CLAUDE_CODE_MODEL_ID,
} from './runners/claude-code/agent.js';
export type { ClaudeCodeRunOptions, TurnStateUpdate } from './runners/claude-code/agent.js';

// Grader engine
export {
  runGraders,
  llmJudge,
  passRate,
  collectGraderFiles,
  walkFiles,
  EXCLUDED_EVAL_DIRS,
  EXCLUDED_EVAL_FILES,
  extractCodeBlocks,
  gradeText,
  BASELINE_LEVELS,
  AGENT_LEVELS,
  AGENT_MCP_LEVELS,
  HALLUCINATION_PENALTY,
  SECURITY_PENALTY_HARDCODED_SECRET,
  SECURITY_PENALTY_INSECURE_STORAGE,
  SECURITY_PENALTY_EXPOSED_SECRET,
  FAKE_API_PATTERNS,
  CREDENTIAL_PATTERNS,
  registerExecutor,
  getExecutor,
  executeGrader,
} from './graders/index.js';

export type { GraderContext, GraderExecutor } from './graders/index.js';

// CLI
export {
  KNOWN_WORKING_MODELS,
  DEFAULT_MODEL,
  ALL_MODES,
  KNOWN_TOOLS,
  MATRIX_TOOL_SETS,
  DEFAULT_AGENT_TYPE,
  parseToolsArg,
  type Mode,
  validateApiKey,
  validateModels,
  validateModes,
  validateEvalIds,
  validateTools,
  validateWorkers,
  validateAgentType,
  parseRunConfig,
  type RunConfig,
  type ParseRunConfigOptions,
  spawnEval,
  mergeIntoOutput,
} from './cli/index.js';

// Persistence
export { resultKey, mergeResults, loadResults, saveResults, resolveOutputPath } from './persistence/index.js';