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
});
