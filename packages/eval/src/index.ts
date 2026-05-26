/**
 * @a0/eval — Evaluation framework: re-exports core + runner infrastructure.
 */

// Re-export everything from @a0/eval-core
export * from '@a0/eval-core';

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
  runCli,
  runJob,
  buildJobList,
  buildSubprocessArgs,
} from './cli/index.js';

// Baseline runner
export { runBaseline, llmCall } from './runners/baseline.js';

// Scorer
export { score, scoreToGrade } from './scorer.js';

// Persistence
export { resultKey, mergeResults, loadResults, saveResults, resolveOutputPath } from './persistence/index.js';

// Braintrust reporters
export { createBraintrustReporter, experimentName, mapResult } from './reporters/braintrust.js';
export type { BraintrustReporter, BraintrustReporterOptions } from './reporters/braintrust.js';
export { syncDataset, toEvalSummaries } from './reporters/braintrust-dataset.js';
export type { EvalSummary, DatasetSyncOptions } from './reporters/braintrust-dataset.js';

// Recommendations
export type { RecommendationInput } from './recommendations/index.js';
export { generateRecommendations, collectSkillContent } from './recommendations/index.js';
