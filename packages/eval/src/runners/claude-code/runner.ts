/**
 * AgentRunner implementation for Claude Code via the Agent SDK.
 *
 * Skills are copied into the workspace filesystem so Claude Code can access
 * them with its native Read/Glob tools instead of the ReAct-only skill tools.
 */

import type { AgentRunner, RunParams, RunResult } from '../agent-runner.js';
import type { EvalDefinition } from '@a0/eval-core';
import { CopySkillsStrategy } from '../skills/strategy.js';
import type { SkillsStrategy } from '../skills/strategy.js';
import { runClaudeCodeAgent, CLAUDE_CODE_MODEL_ID } from './agent.js';

export class ClaudeCodeRunner implements AgentRunner {
  private readonly skillsStrategy: SkillsStrategy = new CopySkillsStrategy('.claude/skills');

  async prepareSkills(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    return this.skillsStrategy.apply(evalDef, workspace);
  }

  async run({ evalDef, workspace, model, tools }: RunParams): Promise<RunResult> {
    // Translate ATKO short alias to the full Anthropic model ID the SDK expects.
    // If the caller already passed the sentinel 'claude-code', omit the model flag and
    // let Claude Code use its default.
    const claudeModel = model !== CLAUDE_CODE_MODEL_ID && model.startsWith('claude-') ? model : undefined;
    const record = await runClaudeCodeAgent(evalDef, workspace, { tools, model: claudeModel });
    return { record, resolvedModel: record.model ?? CLAUDE_CODE_MODEL_ID };
  }
}
