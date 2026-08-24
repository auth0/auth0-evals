/**
 * AgentRunner implementation for DeepSeek via the Codex SDK.
 */

import type { AgentRunner, RunParams, RunResult, EvalDefinition, SkillsStrategy } from '@a0/evals-core';
import { CopySkillsStrategy } from '@a0/evals-core';
import { runDeepSeekAgent, DEEPSEEK_MODEL_ID } from './agent.js';

export class DeepSeekRunner implements AgentRunner {
  private readonly skillsStrategy: SkillsStrategy = new CopySkillsStrategy('.codex/skills');

  async prepareSkills(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    return this.skillsStrategy.apply(evalDef, workspace);
  }

  async run({ evalDef, workspace, model, tools }: RunParams): Promise<RunResult> {
    const isDeepSeekModel = model === DEEPSEEK_MODEL_ID || model.startsWith('deepseek-');
    const deepseekModel = isDeepSeekModel && model !== DEEPSEEK_MODEL_ID ? model : undefined;
    const record = await runDeepSeekAgent(evalDef, workspace, { tools, model: deepseekModel });
    return { record, resolvedModel: record.model ?? DEEPSEEK_MODEL_ID };
  }
}
