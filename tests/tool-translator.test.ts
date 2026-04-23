/**
 * Unit tests for ToolTranslator implementations.
 */

import { describe, it, expect } from 'vitest';
import { IdentityTranslator } from '../src/agent_eval/runners/react/identity-translator.js';
import { ClaudeCodeTranslator } from '../src/agent_eval/runners/claude-code/translator.js';
import { CopilotCliTranslator } from '../src/agent_eval/runners/copilot/translator.js';

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

describe('CopilotCliTranslator — mapping and args', () => {
  const translator = new CopilotCliTranslator();

  it('maps common tool names to internal taxonomy', () => {
    expect(translator.mapName('bash')).toBe('run_command');
    expect(translator.mapName('view')).toBe('read_file');
    expect(translator.mapName('edit')).toBe('write_file');
    expect(translator.mapName('glob')).toBe('list_files');
    expect(translator.mapName('web_fetch')).toBe('fetch_url');
  });

  it('maps create to write_file', () => {
    expect(translator.mapName('create')).toBe('write_file');
  });

  it('maps read_bash to run_command', () => {
    expect(translator.mapName('read_bash')).toBe('run_command');
  });

  it('normalizes bash args to command', () => {
    expect(translator.normalizeArgs('bash', { command: 'npm test' })).toEqual({ command: 'npm test' });
  });

  it('normalizes read_bash args to command', () => {
    expect(translator.normalizeArgs('read_bash', { command: 'cat file.txt' })).toEqual({ command: 'cat file.txt' });
  });

  it('normalizes view args to path', () => {
    expect(translator.normalizeArgs('view', { path: 'src/index.ts' })).toEqual({ path: 'src/index.ts' });
  });

  it('normalizes create args to path and content', () => {
    expect(translator.normalizeArgs('create', { path: 'src/App.tsx', content: 'hello' })).toEqual({
      path: 'src/App.tsx',
      content: 'hello',
    });
  });
});

describe('CopilotCliTranslator — classifications', () => {
  const translator = new CopilotCliTranslator();

  it('classifies web_fetch as doc lookup', () => {
    expect(translator.isDocLookup('web_fetch')).toBe(true);
  });

  it('classifies mcp__ tools as doc lookup', () => {
    expect(translator.isDocLookup('mcp__auth0_docs__search_auth0_docs')).toBe(true);
  });

  it('classifies ask_user as interruption', () => {
    expect(translator.isInterruption('ask_user')).toBe(true);
  });

  it('classifies report_intent and skill as internal tools', () => {
    expect(translator.isInternalTool('report_intent')).toBe(true);
    expect(translator.isInternalTool('skill')).toBe(true);
  });

  it('classifies stop_bash and list_bash as internal tools', () => {
    expect(translator.isInternalTool('stop_bash')).toBe(true);
    expect(translator.isInternalTool('list_bash')).toBe(true);
  });
});
