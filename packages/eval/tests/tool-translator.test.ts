/**
 * Unit tests for ToolTranslator implementations (Claude Code, Copilot, Gemini).
 */

import { describe, it, expect } from 'vitest';
import { ClaudeCodeTranslator } from '../src/runners/claude-code/translator.js';
import { CopilotCliTranslator } from '../src/runners/copilot/translator.js';
import { GeminiCliTranslator } from '../src/runners/gemini-cli/translator.js';
import { CodexTranslator } from '../src/runners/codex/translator.js';

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

  it('tracked tools are not internal', () => {
    for (const tool of [
      'TodoWrite',
      'TodoRead',
      'Task',
      'TaskOutput',
      'KillShell',
      'EnterPlanMode',
      'ExitPlanMode',
      'Bash',
      'Read',
      'WebFetch',
    ]) {
      expect(translator.isInternalTool(tool)).toBe(false);
    }
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
    ['read_file', 'read_file'],
    ['write_file', 'write_file'],
    ['edit_file', 'write_file'],
    ['replace_in_file', 'write_file'],
    ['run_shell_command', 'run_command'],
    ['list_directory', 'list_files'],
    ['create_directory', 'run_command'],
    ['move_file', 'run_command'],
    ['copy_file', 'run_command'],
    ['delete_file', 'run_command'],
    ['glob', 'list_files'],
    ['grep', 'list_files'],
    ['replace', 'write_file'],
    ['web_fetch', 'fetch_url'],
    ['web_search', 'fetch_url'],
    ['update_topic', 'plan'],
    ['activate_skill', 'skill'],
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

  it('normalizes activate_skill with skill field', () => {
    expect(translator.normalizeArgs('activate_skill', { skill: 'auth0-nextjs' })).toEqual({ name: 'auth0-nextjs' });
  });

  it('normalizes activate_skill falls back to name field', () => {
    expect(translator.normalizeArgs('activate_skill', { name: 'auth0-nextjs' })).toEqual({ name: 'auth0-nextjs' });
  });

  it('normalizes activate_skill defaults to empty string', () => {
    expect(translator.normalizeArgs('activate_skill', {})).toEqual({ name: '' });
  });

  it('passes through args for update_topic', () => {
    const args = { topic: 'Auth0 integration', summary: 'Adding login', intent: 'Setup auth' };
    expect(translator.normalizeArgs('update_topic', args)).toEqual(args);
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

describe('CodexTranslator — mapping', () => {
  const translator = new CodexTranslator();

  it.each([
    ['command_execution', 'run_command'],
    ['exec_command', 'run_command'],
    ['shell', 'run_command'],
    ['bash', 'run_command'],
    ['run_command', 'run_command'],
    ['read_file', 'read_file'],
    ['write_file', 'write_file'],
    ['edit_file', 'write_file'],
    ['patch', 'write_file'],
    ['apply_diff', 'write_file'],
    ['create_file', 'write_file'],
    ['delete_file', 'run_command'],
    ['list_files', 'list_files'],
    ['glob', 'list_files'],
    ['grep', 'list_files'],
    ['web_fetch', 'fetch_url'],
    ['web_search', 'fetch_url'],
  ])('maps "%s" → "%s"', (codexName, expected) => {
    expect(translator.mapName(codexName)).toBe(expected);
  });

  it('passes through unknown tool names', () => {
    expect(translator.mapName('some_unknown_tool')).toBe('some_unknown_tool');
  });
});

describe('CodexTranslator — normalizeArgs', () => {
  const translator = new CodexTranslator();

  it('normalizes command_execution command field', () => {
    expect(translator.normalizeArgs('command_execution', { command: 'npm install' })).toEqual({ command: 'npm install' });
  });

  it('normalizes exec_command with cmd fallback', () => {
    expect(translator.normalizeArgs('exec_command', { cmd: 'ls' })).toEqual({ command: 'ls' });
  });

  it('normalizes read_file path', () => {
    expect(translator.normalizeArgs('read_file', { path: 'src/app.ts' })).toEqual({ path: 'src/app.ts' });
  });

  it('normalizes read_file file_path fallback', () => {
    expect(translator.normalizeArgs('read_file', { file_path: 'src/app.ts' })).toEqual({ path: 'src/app.ts' });
  });

  it('normalizes write_file to path and content', () => {
    expect(translator.normalizeArgs('write_file', { path: 'out.ts', content: 'hello' })).toEqual({ path: 'out.ts', content: 'hello' });
  });

  it('normalizes edit_file new_content to content', () => {
    expect(translator.normalizeArgs('edit_file', { path: 'a.ts', new_content: 'updated' })).toEqual({ path: 'a.ts', content: 'updated' });
  });

  it('normalizes delete_file to rm command', () => {
    expect(translator.normalizeArgs('delete_file', { path: 'a.ts' })).toEqual({ command: 'rm a.ts' });
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

describe('CodexTranslator — classifications', () => {
  const translator = new CodexTranslator();

  it('classifies web_fetch and web_search as doc lookups', () => {
    expect(translator.isDocLookup('web_fetch')).toBe(true);
    expect(translator.isDocLookup('web_search')).toBe(true);
  });

  it('classifies mcp_-prefixed tools as doc lookups', () => {
    expect(translator.isDocLookup('mcp__auth0-docs__search_auth0_docs')).toBe(true);
    expect(translator.isDocLookup('mcp_auth0_docs')).toBe(true);
  });

  it('classifies tools with "search" or "doc" in name as doc lookups', () => {
    expect(translator.isDocLookup('search_docs')).toBe(true);
    expect(translator.isDocLookup('fetch_doc')).toBe(true);
  });

  it('does not classify file tools as doc lookups', () => {
    expect(translator.isDocLookup('read_file')).toBe(false);
    expect(translator.isDocLookup('command_execution')).toBe(false);
  });

  it('never classifies any tool as an interruption', () => {
    expect(translator.isInterruption('ask_user')).toBe(false);
    expect(translator.isInterruption('web_fetch')).toBe(false);
  });

  it('never classifies any tool as internal', () => {
    expect(translator.isInternalTool('command_execution')).toBe(false);
    expect(translator.isInternalTool('anything')).toBe(false);
  });
});
