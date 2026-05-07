/**
 * AgentRunner interface and registry.
 *
 * Each agent (ReAct, Claude Code, Copilot, Gemini CLI, …) implements AgentRunner
 * and registers itself at startup via registerRunner().
 *
 * runAgentJob() in run.ts calls getRunner(agentType) and delegates to the
 * runner — no per-agent if/else required.
 */

import type { RunRecord } from '../types/scorer.js';
import type { EvalDefinition } from '../types/eval.js';
import type { AgentType } from '../types/agents.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunResult {
  record: RunRecord;
  /** The actual model ID recorded in results (may differ from the input alias). */
  resolvedModel: string;
}

export interface RunParams {
  evalDef: EvalDefinition;
  workspace: string;
  model: string;
  tools: string[];
  apiKey: string;
}

/**
 * Contract every agent runner must fulfil.
 *
 * Adding a new agent means:
 *   1. Create a class implementing this interface.
 *   2. Add the new agent id to KNOWN_AGENT_TYPES in types/agents.ts.
 *   3. Register it at startup via registerRunner().
 *   That's it — no changes to run.ts dispatch logic required.
 */
export interface AgentRunner {
  /**
   * Prepare skills for this agent's execution style.
   *
   * Only called when `tools` contains `'skills'` — the caller is responsible
   * for that guard. Implementations should:
   *   - ReAct-style:      augment evalDef.agentSystemPrompt with a notice + tool hints.
   *   - Filesystem-style: copy skill files into the workspace and update the prompt.
   *
   * The `workspace` path is provided for filesystem-native agents; prompt-based
   * strategies may ignore it.
   */
  prepareSkills(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition>;

  /**
   * Execute the agent against the prepared eval and return a RunRecord plus
   * the resolved model identifier to store in results.
   */
  run(params: RunParams): Promise<RunResult>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const _registry = new Map<AgentType, AgentRunner>();

export function registerRunner(type: AgentType, runner: AgentRunner): void {
  _registry.set(type, runner);
}

export function getRunner(type: AgentType): AgentRunner {
  const runner = _registry.get(type);
  if (!runner) {
    throw new Error(
      `No agent runner registered for type "${type}". ` +
        `Did you forget to call registerRunner() for this type, or ensure the runner registry bootstrap has been executed?`,
    );
  }
  return runner;
}
