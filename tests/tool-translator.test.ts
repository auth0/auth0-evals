/**
 * Unit tests for ToolTranslator implementations.
 */

import { describe, it, expect } from 'vitest';
import { IdentityTranslator, ClaudeCodeTranslator } from '../src/agent_eval/tool-translator.js';

describe('IdentityTranslator', () => {
  const translator = new IdentityTranslator();

  it('returns names unchanged', () => {
    expect(translator.mapName('read_file')).toBe('read_file');
    expect(translator.mapName('run_command')).toBe('run_command');
    expect(translator.mapName('anything')).toBe('anything');
  });

  it('returns args unchanged', () => {
    const args = { path: 'test.txt', content: 'hello' };
    expect(translator.normalizeArgs('read_file', args)).toEqual(args);
  });

  it('never classifies as doc lookup', () => {
    expect(translator.isDocLookup('fetch_url')).toBe(false);
    expect(translator.isDocLookup('anything')).toBe(false);
  });

  it('never classifies as interruption', () => {
    expect(translator.isInterruption('ask_user')).toBe(false);
    expect(translator.isInterruption('anything')).toBe(false);
  });
});

describe('ClaudeCodeTranslator — isDocLookup / isInterruption', () => {
  const translator = new ClaudeCodeTranslator();

  it('classifies WebFetch and WebSearch as doc lookups', () => {
    expect(translator.isDocLookup('WebFetch')).toBe(true);
    expect(translator.isDocLookup('WebSearch')).toBe(true);
  });

  it('classifies mcp__ prefixed tools as doc lookups', () => {
    expect(translator.isDocLookup('mcp__auth0_docs__search_auth0_docs')).toBe(true);
    expect(translator.isDocLookup('mcp__anything__tool')).toBe(true);
  });

  it('does not classify non-doc tools as doc lookups', () => {
    expect(translator.isDocLookup('Bash')).toBe(false);
    expect(translator.isDocLookup('Read')).toBe(false);
  });

  it('classifies AskUserQuestion as interruption', () => {
    expect(translator.isInterruption('AskUserQuestion')).toBe(true);
  });

  it('does not classify other tools as interruptions', () => {
    expect(translator.isInterruption('Bash')).toBe(false);
    expect(translator.isInterruption('WebFetch')).toBe(false);
  });
});

describe('ClaudeCodeTranslator — isInternalTool', () => {
  const translator = new ClaudeCodeTranslator();

  it.each(['TodoWrite', 'TodoRead', 'Task', 'TaskOutput', 'KillShell', 'EnterPlanMode', 'ExitPlanMode'])(
    '%s is internal',
    (name) => {
      expect(translator.isInternalTool(name)).toBe(true);
    },
  );

  it('external tools are not internal', () => {
    expect(translator.isInternalTool('Bash')).toBe(false);
    expect(translator.isInternalTool('Read')).toBe(false);
    expect(translator.isInternalTool('WebFetch')).toBe(false);
  });
});

describe('IdentityTranslator — isInternalTool', () => {
  const translator = new IdentityTranslator();

  it('always returns false', () => {
    expect(translator.isInternalTool('TodoWrite')).toBe(false);
    expect(translator.isInternalTool('anything')).toBe(false);
  });
});
