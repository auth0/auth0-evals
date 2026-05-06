/**
 * AgentRunner implementation for the Gemini CLI.
 */

import type { AgentRunner, RunParams, RunResult } from '../agent-runner.js';
import type { EvalDefinition } from '@a0/eval-core';
import { CopySkillsStrategy } from '../skills/strategy.js';
import type { SkillsStrategy } from '../skills/strategy.js';
import { runGeminiCliAgent, GEMINI_CLI_MODEL_ID } from './agent.js';

export class GeminiCliRunner implements AgentRunner {
  private readonly skillsStrategy: SkillsStrategy = new CopySkillsStrategy('.gemini/skills');

  async prepareSkills(evalDef: EvalDefinition, workspace: string): Promise<EvalDefinition> {
    return this.skillsStrategy.apply(evalDef, workspace);
  }

  async run({ evalDef, workspace, model, tools }: RunParams): Promise<RunResult> {
    // Accept either the sentinel 'gemini-cli' or a real Gemini model ID
    // (e.g. 'gemini-2.5-flash').  Anything else (e.g. the default 'gpt-5.4')
    // is not a valid Gemini model — fall back to the default flash model so
    // running with --agent-type gemini-cli and no --model flag still works.
    const isGeminiModel = model === GEMINI_CLI_MODEL_ID || model.startsWith('gemini-');
    const geminiModel = isGeminiModel && model !== GEMINI_CLI_MODEL_ID ? model : undefined;
    const record = await runGeminiCliAgent(evalDef, workspace, { tools, model: geminiModel });
    return { record, resolvedModel: record.model ?? GEMINI_CLI_MODEL_ID };
  }
}
