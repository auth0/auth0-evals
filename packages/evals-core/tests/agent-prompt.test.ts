import { describe, it, expect } from 'vitest';
import { agentPrompt } from '../src/utils/agent-prompt.js';

describe('agentPrompt', () => {
  it('prepends systemContext to the task', () => {
    expect(agentPrompt({ systemContext: 'Domain: dev.example.com', userPrompt: 'Do the task.' })).toBe(
      'Domain: dev.example.com\n\nDo the task.',
    );
  });

  it('returns only the task when there is no systemContext', () => {
    expect(agentPrompt({ userPrompt: 'Do the task.' })).toBe('Do the task.');
  });
});
