import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentRunner } from '../src/runners/agent-runner.js';

describe('agent-runner registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function freshModule() {
    return await import('../src/runners/agent-runner.js');
  }

  const mockRunner: AgentRunner = {
    prepareSkills: vi.fn().mockResolvedValue({}),
    run: vi.fn().mockResolvedValue({ record: {}, resolvedModel: 'test' }),
  };

  it('registerRunner + getRunner round-trips', async () => {
    const { registerRunner, getRunner } = await freshModule();
    registerRunner('claude-code', mockRunner);
    expect(getRunner('claude-code')).toBe(mockRunner);
  });

  it('getRunner throws for unregistered type', async () => {
    const { getRunner } = await freshModule();
    expect(() => getRunner('copilot')).toThrow(/No agent runner registered for type "copilot"/);
  });

  it('registering same type twice overwrites', async () => {
    const { registerRunner, getRunner } = await freshModule();
    const otherRunner: AgentRunner = {
      prepareSkills: vi.fn().mockResolvedValue({}),
      run: vi.fn().mockResolvedValue({ record: {}, resolvedModel: 'other' }),
    };
    registerRunner('codex', mockRunner);
    registerRunner('codex', otherRunner);
    expect(getRunner('codex')).toBe(otherRunner);
  });
});
