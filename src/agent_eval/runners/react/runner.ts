/**
 * AgentRunner implementation for the custom ReAct loop.
 *
 * Skills are injected into the agent system prompt so the agent can access
 * them via the `list_skill_files` / `read_skill_file` tools.
 */

import type { AgentRunner, RunParams, RunResult } from '../../agent-runner.js';
import type { EvalDefinition } from '../../../runners/loader.js';
import { InjectSkillsStrategy } from '../../skills/strategy.js';
import type { SkillsStrategy } from '../../skills/strategy.js';
import { runAgent } from './agent.js';

export class ReactAgentRunner implements AgentRunner {
  private readonly skillsStrategy: SkillsStrategy = new InjectSkillsStrategy();

  async prepareSkills(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    return this.skillsStrategy.apply(evalDef, workspace);
  }

  async run({ evalDef, workspace, model, tools, apiKey }: RunParams): Promise<RunResult> {
    const record = await runAgent(
      apiKey,
      model,
      { name: evalDef.id, agentSystemPrompt: evalDef.agentSystemPrompt, userPrompt: evalDef.userPrompt },
      workspace,
      undefined,
      tools,
    );
    return { record, resolvedModel: model };
  }
}
