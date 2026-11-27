import { describe, it, expect, beforeEach } from 'vitest';
import { judge, GraderLevel } from '@a0/evals-graders';
import type { GraderDef } from '@a0/evals-graders';
import { setFrameworkConfig } from '../../src/config/framework-config.js';
import { DEFAULT_FRAMEWORK_CONFIG } from '../../src/config/defaults.js';
import { SECURITY_JUDGE_QUESTION, securityJudgeGrader, agentGraderDefs } from '../../src/graders/security-judge.js';
import type { EvalDefinition } from '../../src/types/eval.js';

function setEnabled(enabled: boolean | undefined): void {
  const cfg = { ...DEFAULT_FRAMEWORK_CONFIG };
  if (enabled === undefined) {
    (cfg as { securityJudge?: unknown }).securityJudge = undefined;
  } else {
    cfg.securityJudge = { enabled };
  }
  setFrameworkConfig(cfg);
}

function evalDef(graders: GraderDef[], userPrompt = 'Add login to the app'): EvalDefinition {
  return { graders, userPrompt } as unknown as EvalDefinition;
}

const existing = judge('Is the app wired up?', GraderLevel.L4);

describe('securityJudgeGrader', () => {
  it('question passes judge() validation', () => {
    expect(() => judge(SECURITY_JUDGE_QUESTION, GraderLevel.L3)).not.toThrow();
  });

  it('def is L3 judge, input both, numberTrace, traceFirst, fixed name', () => {
    const def = securityJudgeGrader('task');
    expect(def.kind).toBe('judge');
    expect(def.question).toBe(SECURITY_JUDGE_QUESTION);
    expect(def.level).toBe(GraderLevel.L3);
    expect(def.input).toBe('both');
    expect(def.numberTrace).toBe(true);
    expect(def.traceFirst).toBe(true);
    expect('shadow' in def).toBe(false);
    expect(def.name).toBe('Security judge');
  });

  it('context embeds task prompt and explicit-request exemption', () => {
    const { context } = securityJudgeGrader('Create an app named demo');
    expect(context).toContain('anything it explicitly requests is NOT a violation');
    expect(context).toContain('<task>\nCreate an app named demo\n</task>');
  });

  it('task prompt is redacted', () => {
    const { context } = securityJudgeGrader('Use key sk-notarealkey0123456789 to call the API');
    expect(context).not.toContain('notarealkey0123456789');
    expect(context).toContain('[REDACTED SECRET]');
  });
});

describe('agentGraderDefs', () => {
  beforeEach(() => setEnabled(true));

  it('appended when enabled or unset', () => {
    const def = evalDef([existing]);
    for (const enabled of [true, undefined]) {
      setEnabled(enabled);
      const defs = agentGraderDefs(def);
      expect(defs).toHaveLength(2);
      expect(defs[0]).toBe(existing);
      expect(defs[1].context).toContain('Add login to the app');
    }
  });

  it('not appended when securityJudge.enabled false', () => {
    setEnabled(false);
    expect(agentGraderDefs(evalDef([existing]))).toEqual([existing]);
  });

  it('eval with zero graders still gets it', () => {
    const defs = agentGraderDefs(evalDef([]));
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('Security judge');
  });

  it('does not mutate evalDef.graders', () => {
    const def = evalDef([existing]);
    const before = def.graders;
    agentGraderDefs(def);
    expect(def.graders).toBe(before);
    expect(def.graders).toHaveLength(1);
  });
});
