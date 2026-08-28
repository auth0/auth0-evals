import { describe, it, expect } from 'vitest';
import { isBedrockModel, isClaudeModel, isGeminiModel, isGptModel, isLlamaModel } from '../src/config/model-detect.js';

describe('model detection', () => {
  it('isBedrockModel matches claude- prefix', () => {
    expect(isBedrockModel('claude-opus-5')).toBe(true);
    expect(isBedrockModel('gpt-5.6-sol')).toBe(false);
  });

  it('isClaudeModel is an alias for isBedrockModel', () => {
    expect(isClaudeModel('claude-sonnet-5')).toBe(true);
    expect(isClaudeModel('gemini-3.1-pro-preview')).toBe(false);
  });

  it('isGeminiModel matches gemini- prefix', () => {
    expect(isGeminiModel('gemini-3.1-pro-preview')).toBe(true);
    expect(isGeminiModel('claude-opus-5')).toBe(false);
  });

  it('isGptModel matches gpt- prefix', () => {
    expect(isGptModel('gpt-5.6-sol')).toBe(true);
    expect(isGptModel('claude-opus-5')).toBe(false);
  });

  it('isLlamaModel matches llama- prefix', () => {
    expect(isLlamaModel('llama-4-maverick-17b')).toBe(true);
    expect(isLlamaModel('claude-opus-5')).toBe(false);
    expect(isLlamaModel('gpt-5.6-sol')).toBe(false);
    expect(isLlamaModel('gemini-3.1-pro-preview')).toBe(false);
    expect(isLlamaModel('')).toBe(false);
  });
});
