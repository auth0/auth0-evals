/**
 * Unit tests for ToolTranslator implementations.
 */

import { describe, it, expect } from 'vitest';
import { IdentityTranslator } from '@a0/eval-react-runner';
import { ClaudeCodeTranslator, CopilotCliTranslator, GeminiCliTranslator } from '@a0/eval';

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

describe('GeminiCliTranslator — mapping', () => {
  const translator = new GeminiCliTranslator();

  it.each([
    ['read_file', 'read'],
    ['write_file', 'write'],
    ['edit_file', 'edit'],
    ['replace_in_file', 'edit'],
    ['run_shell_command', 'bash'],
    ['list_directory', 'bash'],
    ['create_directory', 'bash'],
    ['move_file', 'bash'],
    ['copy_file', 'bash'],
    ['delete_file', 'bash'],
    ['glob', 'glob'],
    ['grep', 'grep'],
    ['web_fetch', 'webfetch'],
    ['web_search', 'webfetch'],
  ])('maps "%s" → "%s"', (geminiName, expected) => {
    expect(translator.mapName(geminiName)).toBe(expected);
  });

  it('preserves full name for mcp__-prefixed tools', () => {
    expect(translator.mapName('mcp__auth0-docs__search_auth0_docs')).toBe('mcp__auth0-docs__search_auth0_docs');
    expect(translator.mapName('mcp__anything__tool')).toBe('mcp__anything__tool');
  });

  it('passes through unknown tool names', () => {
    expect(translator.mapName('some_unknown_tool')).toBe('some_unknown_tool');
  });
});

describe('GeminiCliTranslator — normalizeArgs', () => {
  const translator = new GeminiCliTranslator();

  it('normalizes read_file file_path to path', () => {
    expect(translator.normalizeArgs('read_file', { file_path: 'src/app.ts' })).toEqual({ path: 'src/app.ts' });
  });

  it('normalizes read_file path passthrough', () => {
    expect(translator.normalizeArgs('read_file', { path: 'src/app.ts' })).toEqual({ path: 'src/app.ts' });
  });

  it('normalizes write_file args to path and content', () => {
    expect(translator.normalizeArgs('write_file', { path: 'out.ts', content: 'hello' })).toEqual({
      path: 'out.ts',
      content: 'hello',
    });
  });

  it('normalizes run_shell_command to command', () => {
    expect(translator.normalizeArgs('run_shell_command', { command: 'npm install' })).toEqual({
      command: 'npm install',
    });
  });

  it('normalizes edit_file new_content to content', () => {
    expect(translator.normalizeArgs('edit_file', { path: 'a.ts', new_content: 'updated' })).toEqual({
      path: 'a.ts',
      content: 'updated',
    });
  });

  it('normalizes web_fetch url', () => {
    expect(translator.normalizeArgs('web_fetch', { url: 'https://auth0.com' })).toEqual({ url: 'https://auth0.com' });
  });

  it('normalizes web_search query to url', () => {
    expect(translator.normalizeArgs('web_search', { query: 'auth0 login' })).toEqual({ url: 'auth0 login' });
  });

  it('passes through args for unknown tools', () => {
    const args = { foo: 'bar' };
    expect(translator.normalizeArgs('unknown_tool', args)).toEqual(args);
  });
});

describe('GeminiCliTranslator — classifications', () => {
  const translator = new GeminiCliTranslator();

  it('classifies web_fetch and web_search as doc lookups', () => {
    expect(translator.isDocLookup('web_fetch')).toBe(true);
    expect(translator.isDocLookup('web_search')).toBe(true);
  });

  it('classifies mcp_-prefixed tools as doc lookups', () => {
    expect(translator.isDocLookup('mcp__auth0-docs__search_auth0_docs')).toBe(true);
  });

  it('classifies tools with "search" or "doc" in name as doc lookups', () => {
    expect(translator.isDocLookup('search_something')).toBe(true);
    expect(translator.isDocLookup('fetch_doc')).toBe(true);
  });

  it('does not classify file tools as doc lookups', () => {
    expect(translator.isDocLookup('read_file')).toBe(false);
    expect(translator.isDocLookup('run_shell_command')).toBe(false);
  });

  it('never classifies any tool as an interruption', () => {
    expect(translator.isInterruption('ask_user')).toBe(false);
    expect(translator.isInterruption('web_fetch')).toBe(false);
    expect(translator.isInterruption('anything')).toBe(false);
  });

  it('never classifies any tool as internal', () => {
    expect(translator.isInternalTool('read_file')).toBe(false);
    expect(translator.isInternalTool('anything')).toBe(false);
  });
});
