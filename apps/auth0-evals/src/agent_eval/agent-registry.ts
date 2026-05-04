/**
 * Agent runner registry bootstrap.
 *
 * Call initAgentRegistry() once at startup (e.g. in runAgentJob) so that
 * getRunner() resolves correctly throughout the process.
 *
 * To add a new agent:
 *   1. Implement AgentRunner in a new file.
 *   2. Add its id to KNOWN_AGENT_TYPES in cli/constants.ts.
 *   3. Import and register it inside initAgentRegistry() below — one line.
 */

import { registerRunner, getRunner, GeminiCliRunner } from '@a0/eval';
import { ReactAgentRunner } from './runners/react/runner.js';
import { ClaudeCodeRunner } from '@a0/eval';
import { CopilotCliRunner } from './runners/copilot/runner.js';

export function initAgentRegistry(): void {
  registerRunner('auth0-ReAct-agent', new ReactAgentRunner());
  registerRunner('claude-code', new ClaudeCodeRunner());
  registerRunner('copilot', new CopilotCliRunner());
  registerRunner('gemini-cli', new GeminiCliRunner());
}

// Re-export getRunner so callers only need to import this file.
export { getRunner };
