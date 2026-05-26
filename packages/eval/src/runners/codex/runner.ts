/**
 * AgentRunner implementation for the OpenAI Codex CLI.
 */

import type { AgentRunner, RunParams, RunResult, EvalDefinition, SkillsStrategy } from '@a0/eval-core';
import { CopySkillsStrategy } from '@a0/eval-core';
import { runCodexAgent, CODEX_MODEL_ID } from './agent.js';

export class CodexRunner implements AgentRunner {
  private readonly skillsStrategy: SkillsStrategy = new CopySkillsStrategy('.codex/skills');

  async prepareSkills(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    return this.skillsStrategy.apply(evalDef, workspace);
  }

  async run({ evalDef, workspace, model, tools }: RunParams): Promise<RunResult> {
    // Only pass GPT-family models through — Codex CLI is OpenAI-specific.
    // Non-GPT models (gemini-*, claude-*) and the sentinel 'codex' fall back to CODEX_DEFAULT_MODEL.
    const codexModel = model.startsWith('gpt-') ? model : undefined;
    const record = await runCodexAgent(evalDef, workspace, { tools, model: codexModel });
    return { record, resolvedModel: record.model ?? CODEX_MODEL_ID };
  }
}
