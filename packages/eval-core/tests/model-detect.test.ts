import { describe, it, expect } from 'vitest';
import { isBedrockModel, isClaudeModel, isGeminiModel, isGptModel } from '../src/config/model-detect.js';

describe('model detection', () => {
  it('isBedrockModel matches claude- prefix', () => {
    expect(isBedrockModel('claude-opus-4-7')).toBe(true);
    expect(isBedrockModel('gpt-5.4')).toBe(false);
  });

  it('isClaudeModel is an alias for isBedrockModel', () => {
    expect(isClaudeModel('claude-sonnet-4-6')).toBe(true);
    expect(isClaudeModel('gemini-3.1-pro-preview')).toBe(false);
  });

  it('isGeminiModel matches gemini- prefix', () => {
    expect(isGeminiModel('gemini-3.1-pro-preview')).toBe(true);
    expect(isGeminiModel('claude-opus-4-7')).toBe(false);
  });

  it('isGptModel matches gpt- prefix', () => {
    expect(isGptModel('gpt-5.4')).toBe(true);
    expect(isGptModel('claude-opus-4-7')).toBe(false);
  });

  it('routes newly added models by prefix', () => {
    // gpt-5.5/5.6 route through the GPT (codex) runner, not Claude/Gemini.
    for (const model of ['gpt-5.5', 'gpt-5.5-mini', 'gpt-5.6']) {
      expect(isGptModel(model)).toBe(true);
      expect(isClaudeModel(model)).toBe(false);
      expect(isGeminiModel(model)).toBe(false);
    }
    // claude-sonnet-5 routes through the Claude (Bedrock) runner.
    expect(isClaudeModel('claude-sonnet-5')).toBe(true);
    expect(isBedrockModel('claude-sonnet-5')).toBe(true);
    expect(isGptModel('claude-sonnet-5')).toBe(false);
  });
});

describe('CLAUDE_EFFORT_MODELS', () => {
  it('includes claude-sonnet-5', async () => {
    const { CLAUDE_EFFORT_MODELS } = await import('../src/config/settings.js');
    expect(CLAUDE_EFFORT_MODELS.has('claude-sonnet-5')).toBe(true);
  });
});
