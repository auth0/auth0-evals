import { describe, it, expect } from 'vitest';
import { classifyActionType } from '../src/runners/classify.js';

describe('classifyActionType', () => {
  it.each([
    ['read_file', 'Discovery'],
    ['list_files', 'Discovery'],
    ['fetch_url', 'Discovery'],
    ['search_auth0_docs', 'Discovery'],
    ['plan', 'Discovery'],
    ['write_file', 'Implementation'],
    ['run_command', 'Implementation'],
    ['finish_task', 'Implementation'],
    ['ask_user', 'Interruption'],
    ['skill', 'Skill'],
  ])('%s (no error) → %s', (name, expected) => {
    expect(classifyActionType(name, false)).toBe(expected);
  });

  it('any tool with causedError → Error', () => {
    expect(classifyActionType('read_file', true)).toBe('Error');
    expect(classifyActionType('plan', true)).toBe('Error');
    expect(classifyActionType('write_file', true)).toBe('Error');
  });

  it('mcp__ prefixed tools → Discovery', () => {
    expect(classifyActionType('mcp__auth0__search_docs', false)).toBe('Discovery');
  });

  it('unknown tool → unknown', () => {
    expect(classifyActionType('some_future_tool', false)).toBe('unknown');
  });
});
