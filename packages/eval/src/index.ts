/**
 * @a0/eval — Evaluation framework: re-exports core + runner infrastructure.
 */

// Re-export everything from @a0/eval-core
export * from '@a0/eval-core';

// Runner infrastructure
export type { AgentRunner, RunParams, RunResult } from './runners/agent-runner.js';
export { registerRunner, getRunner } from './runners/agent-runner.js';
export type { ToolTranslator } from './runners/tool-translator.js';
export { BaseToolTranslator } from './runners/base-translator.js';
export { classifyActionType, primaryArg, detectRetry, classifyErrorCategory } from './runners/classify.js';
export type { SkillsStrategy } from './runners/skills/strategy.js';
export {
  copySkillsToWorkspace,
  augmentWithSkills,
  InjectSkillsStrategy,
  CopySkillsStrategy,
} from './runners/skills/strategy.js';
export { SkillsManager, getSkillsManager, resetSkillsManager } from './runners/skills/config.js';

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

// CLI
export {
  KNOWN_WORKING_MODELS,
  DEFAULT_MODEL,
  KNOWN_TOOLS,
  MATRIX_TOOL_SETS,
  DEFAULT_AGENT_TYPE,
  parseToolsArg,
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

// Scorer
export { score, scoreToGrade } from './scorer.js';

// Persistence
export { resultKey, mergeResults, loadResults, saveResults, resolveOutputPath } from './persistence/index.js';
