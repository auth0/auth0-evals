/**
 * AgentRunner implementation for the opencode agent.
 *
 * Skills are placed in `.claude/skills/` so opencode's native discovery
 * (`.claude/skills/**\/SKILL.md`) picks them up automatically.
 */

import type { AgentRunner, RunParams, RunResult, EvalDefinition } from '@a0/evals-core';
import { CopySkillsStrategy, isLlamaModel } from '@a0/evals-core';
import type { SkillsStrategy } from '@a0/evals-core';
import { runOpencodeAgent, OPENCODE_MODEL_ID, OPENCODE_DEFAULT_MODEL } from './agent.js';

export class OpencodeRunner implements AgentRunner {
  private readonly skillsStrategy: SkillsStrategy = new CopySkillsStrategy('.claude/skills');

  async prepareSkills(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    return this.skillsStrategy.apply(evalDef, workspace);
  }

  async run({ evalDef, workspace, model, tools }: RunParams): Promise<RunResult> {
    // Accept the sentinel 'opencode' or any Llama model (isLlamaModel check).
    // Anything else (e.g. 'claude-...', 'gemini-...', 'gpt-...') is not a valid
    // opencode/llama model — fall back to the default Llama model.
    const resolvedModel = model === OPENCODE_MODEL_ID || isLlamaModel(model) ? model : OPENCODE_DEFAULT_MODEL;
    const effectiveModel = resolvedModel === OPENCODE_MODEL_ID ? OPENCODE_DEFAULT_MODEL : resolvedModel;

    const record = await runOpencodeAgent(evalDef, workspace, { tools, model: effectiveModel });
    return { record, resolvedModel: record.model ?? OPENCODE_MODEL_ID };
  }
}
