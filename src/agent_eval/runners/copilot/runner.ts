/**
 * AgentRunner implementation for the Copilot SDK.
 *
 * Skills are placed in `.github/skills/` so the SDK's native `skillDirectories`
 * config option picks them up automatically — no prompt modification required.
 */

import type { AgentRunner, RunParams, RunResult } from '../../agent-runner.js';
import type { EvalDefinition } from '../../../runners/loader.js';
import { CopilotSdkSkillsStrategy } from '../../skills/strategy.js';
import type { SkillsStrategy } from '../../skills/strategy.js';
import { runCopilotAgent, COPILOT_MODEL_ID } from './agent.js';

export class CopilotCliRunner implements AgentRunner {
  private readonly skillsStrategy: SkillsStrategy = new CopilotSdkSkillsStrategy();

  async prepareSkills(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    return this.skillsStrategy.apply(evalDef, workspace);
  }

  async run({ evalDef, workspace, model, tools }: RunParams): Promise<RunResult> {
    // If the caller passed the sentinel 'copilot', omit --model and let
    // Copilot choose its default model.
    const copilotModel = model !== COPILOT_MODEL_ID ? model : undefined;
    const record = await runCopilotAgent(evalDef, workspace, { tools, model: copilotModel });
    return { record, resolvedModel: record.model ?? COPILOT_MODEL_ID };
  }
}
