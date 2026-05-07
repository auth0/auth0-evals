/**
 * @a0/eval — Evaluation framework: re-exports core + runner infrastructure.
 */

// Re-export everything from @a0/eval-core
export * from '@a0/eval-core';

// Runner infrastructure
export type { AgentRunner, RunParams, RunResult } from './runners/agent-runner.js';
export { registerRunner, getRunner } from './runners/agent-runner.js';
export type { ToolTranslator } from './runners/tool-translator.js';
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
export { getMcpServers, COPILOT_MODEL_ID } from './runners/copilot/agent.js';

// Runner — Gemini CLI
export { GeminiCliRunner } from './runners/gemini-cli/runner.js';
export { runGeminiCliAgent } from './runners/gemini-cli/agent.js';
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
export type { TurnStateUpdate } from './runners/claude-code/agent.js';

// CLI
export {
  KNOWN_WORKING_MODELS,
  DEFAULT_MODEL,
  KNOWN_TOOLS,
  MATRIX_TOOL_SETS,
  DEFAULT_AGENT_TYPE,
  parseToolsArg,
  parseRunConfig,
  type RunConfig,
  spawnEval,
  mergeIntoOutput,
} from './cli/index.js';

// Baseline runner
export { runBaseline, llmCall } from './runners/baseline.js';

// Scorer
export { score, scoreToGrade } from './scorer.js';

// Persistence
export { resultKey, mergeResults, loadResults, saveResults, resolveOutputPath } from './persistence/index.js';
