/**
 * AgentRunner implementation for the Copilot SDK.
 *
 * Skills are placed in `.github/skills/` so the SDK's native `skillDirectories`
 * config option picks them up automatically — no prompt modification required.
 */

import type { AgentRunner, RunParams, RunResult, EvalDefinition, SkillsStrategy } from '@a0/evals-core';
import { CopySkillsStrategy } from '@a0/evals-core';
import { runCopilotAgent, COPILOT_MODEL_ID, COPILOT_DEFAULT_MODEL } from './agent.js';

export class CopilotCliRunner implements AgentRunner {
  private readonly skillsStrategy: SkillsStrategy = new CopySkillsStrategy('.github/skills');

  async prepareSkills(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    return this.skillsStrategy.apply(evalDef, workspace);
  }

  async run({ evalDef, workspace, model, tools }: RunParams): Promise<RunResult> {
    // Accept the sentinel 'copilot' or an explicit GPT model (gpt-*, o*).
    // Anything else (e.g. the global default 'claude-...' or 'gemini-...') is
    // not a valid Copilot model — fall back to the default GPT model.
    const isGptModel = model === COPILOT_MODEL_ID || model.startsWith('gpt-') || model.startsWith('o');
    const copilotModel = isGptModel && model !== COPILOT_MODEL_ID ? model : COPILOT_DEFAULT_MODEL;
    const record = await runCopilotAgent(evalDef, workspace, { tools, model: copilotModel });
    return { record, resolvedModel: record.model ?? COPILOT_MODEL_ID };
  }
}
