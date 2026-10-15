import type { EvalDefinition } from '../types/eval.js';

/** Prompt sent to agent runners: the eval's `## System` text (if any) followed by the task. */
export function agentPrompt(evalDef: Pick<EvalDefinition, 'systemContext' | 'userPrompt'>): string {
  return evalDef.systemContext ? `${evalDef.systemContext}\n\n${evalDef.userPrompt}` : evalDef.userPrompt;
}
