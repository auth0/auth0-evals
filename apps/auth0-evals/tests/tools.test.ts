/**
 * Tests for all tools in src/agent_eval/tools/
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as childProcess from 'node:child_process';
import { makeTmpDir } from './tmp.js';
import { AskUserTool } from '../src/agent_eval/runners/react/tools/ask-user.js';
import { FetchUrlTool } from '../src/agent_eval/runners/react/tools/fetch-url.js';
import { FinishTaskTool } from '../src/agent_eval/runners/react/tools/finish-task.js';
import { ListFilesTool } from '../src/agent_eval/runners/react/tools/list-files.js';
import { ReadFileTool } from '../src/agent_eval/runners/react/tools/read-file.js';
import { RunCommandTool } from '../src/agent_eval/runners/react/tools/run-command.js';
import { collectFiles } from '@a0/eval';
import { WriteFileTool } from '../src/agent_eval/runners/react/tools/write-file.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn().mockImplementation(actual.execSync),
  };
});

const tmpDir = makeTmpDir('tools_test_');

function makeContext(workspace: string, credentials: Record<string, string> = {}) {
  return { workspace, credentials };
}

// ── ListFilesTool tests ───────────────────────────────────────────────────────

describe('ListFilesTool', () => {
  it('lists workspace root when path arg is not provided', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'hello.txt'), '');
    const tool = new ListFilesTool();
    const [result] = await tool.run(makeContext(dir), {});
    expect(result).toContain('(workspace root)');
    expect(result).toContain('hello.txt');
  });

  it('lists files in a subdirectory', async () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'file.txt'), '');
    const tool = new ListFilesTool();
    const [result] = await tool.run(makeContext(dir), { path: 'sub' });
    expect(result).toContain('Directory listing for sub:');
    expect(result).toContain('sub/file.txt');
  });

  it('returns empty directory message for an empty directory', async () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'empty'));
    const tool = new ListFilesTool();
    const [result] = await tool.run(makeContext(dir), { path: 'empty' });
    expect(result).toContain('(empty directory)');
  });

  it('returns non-error result for a non-existent directory', async () => {
    const dir = tmpDir();
    const tool = new ListFilesTool();
    const [result, , , isError] = await tool.run(makeContext(dir), { path: 'nonexistent' });
    expect(result).toContain("Directory not found: 'nonexistent'");
    expect(isError).toBe(false);
  });

  it('returns non-error result when path points to a file and suggests read_file', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'file.txt'), 'content');
    const tool = new ListFilesTool();
    const [result, , , isError] = await tool.run(makeContext(dir), { path: 'file.txt' });
    expect(result).toContain("Path is a file: 'file.txt'");
    expect(result).toContain('read_file');
    expect(isError).toBe(false);
  });

  it('returns access denied for path outside workspace', async () => {
    const dir = tmpDir();
    const tool = new ListFilesTool();
    const [result] = await tool.run(makeContext(dir), { path: '../../etc' });
    expect(result).toBe('Access denied: path is outside workspace');
  });

  it('returns isError=true for path traversal attempts', async () => {
    const dir = tmpDir();
    const tool = new ListFilesTool();
    const [, , , isError] = await tool.run(makeContext(dir), { path: '../../etc' });
    expect(isError).toBe(true);
  });

  it('returns isError=true for paths with null bytes', async () => {
    const dir = tmpDir();
    const tool = new ListFilesTool();
    const [result, , , isError] = await tool.run(makeContext(dir), { path: 'file\0name' });
    expect(isError).toBe(true);
    expect(result).toBe('Path contains invalid characters');
  });
});

// ── WriteFileTool tests ───────────────────────────────────────────────────────

describe('WriteFileTool', () => {
  it('throws when path is an empty string', async () => {
    const tool = new WriteFileTool();
    await expect(tool.run(makeContext(tmpDir()), { path: '', content: 'data' })).rejects.toThrow(
      'write_file requires a file path.',
    );
  });

  it('throws when path is whitespace only', async () => {
    const tool = new WriteFileTool();
    await expect(tool.run(makeContext(tmpDir()), { path: '   ', content: 'data' })).rejects.toThrow(
      'write_file requires a file path.',
    );
  });

  it('writes content and returns a success message with char count', async () => {
    const dir = tmpDir();
    const tool = new WriteFileTool();
    const [result] = await tool.run(makeContext(dir), { path: 'output.txt', content: 'hello' });
    expect(result).toContain('Written: output.txt');
    expect(result).toContain('5 chars');
    expect(readFileSync(join(dir, 'output.txt'), 'utf-8')).toBe('hello');
  });

  it('creates intermediate directories', async () => {
    const dir = tmpDir();
    const tool = new WriteFileTool();
    await tool.run(makeContext(dir), { path: 'a/b/c.txt', content: 'nested' });
    expect(existsSync(join(dir, 'a', 'b', 'c.txt'))).toBe(true);
    expect(readFileSync(join(dir, 'a', 'b', 'c.txt'), 'utf-8')).toBe('nested');
  });

  it('returns access denied for path outside workspace', async () => {
    const dir = tmpDir();
    const tool = new WriteFileTool();
    const [result] = await tool.run(makeContext(dir), { path: '../../evil.txt', content: 'x' });
    expect(result).toBe('Access denied: path is outside workspace');
  });

  it('returns isError=true for path traversal attempts', async () => {
    const dir = tmpDir();
    const tool = new WriteFileTool();
    const [, , , isError] = await tool.run(makeContext(dir), { path: '../../evil.txt', content: 'x' });
    expect(isError).toBe(true);
  });

  it('returns isError=true for paths with control characters', async () => {
    const dir = tmpDir();
    const tool = new WriteFileTool();
    const [result, , , isError] = await tool.run(makeContext(dir), { path: 'file\x01.txt', content: 'x' });
    expect(isError).toBe(true);
    expect(result).toBe('Path contains invalid characters');
  });
});

// ── ReadFileTool tests ────────────────────────────────────────────────────────

describe('ReadFileTool', () => {
  it('throws when path is an empty string', async () => {
    const tool = new ReadFileTool();
    await expect(tool.run(makeContext(tmpDir()), { path: '' })).rejects.toThrow('read_file requires a file path');
  });

  it('throws when path is whitespace only', async () => {
    const tool = new ReadFileTool();
    await expect(tool.run(makeContext(tmpDir()), { path: '   ' })).rejects.toThrow('read_file requires a file path');
  });

  it('reads and returns file contents', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'hello.txt'), 'hello world');
    const tool = new ReadFileTool();
    const [result] = await tool.run(makeContext(dir), { path: 'hello.txt' });
    expect(result).toBe('hello world');
  });

  it('returns non-error result when path points to a directory', async () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'subdir'));
    const tool = new ReadFileTool();
    const [result, , , isError] = await tool.run(makeContext(dir), { path: 'subdir' });
    expect(result).toContain("Path is a directory: 'subdir'");
    expect(result).toContain('list_files');
    expect(isError).toBe(false);
  });

  it('returns non-error file-not-found with nearby files when the parent directory exists', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'nearby.txt'), '');
    const tool = new ReadFileTool();
    const [result, , , isError] = await tool.run(makeContext(dir), { path: 'missing.txt' });
    expect(result).toContain('File not found: missing.txt');
    expect(result).toContain('nearby.txt');
    expect(isError).toBe(false);
  });

  it('returns non-error file-not-found when the parent directory does not exist', async () => {
    const dir = tmpDir();
    const tool = new ReadFileTool();
    const [result, , , isError] = await tool.run(makeContext(dir), { path: 'noparent/missing.txt' });
    expect(result).toContain('File not found: noparent/missing.txt');
    expect(isError).toBe(false);
  });

  it('returns access denied for path outside workspace', async () => {
    const dir = tmpDir();
    const tool = new ReadFileTool();
    const [result] = await tool.run(makeContext(dir), { path: '../../etc/passwd' });
    expect(result).toBe('Access denied: path is outside workspace');
  });

  it('returns result flags [result, false, false, false]', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'f.txt'), 'x');
    const tool = new ReadFileTool();
    const [, isDoc, isInterrupt, isError] = await tool.run(makeContext(dir), { path: 'f.txt' });
    expect(isDoc).toBe(false);
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });

  it('returns isError=true for path traversal attempts', async () => {
    const dir = tmpDir();
    const tool = new ReadFileTool();
    const [, , , isError] = await tool.run(makeContext(dir), { path: '../../etc/passwd' });
    expect(isError).toBe(true);
  });

  it('returns isError=true for paths with null bytes', async () => {
    const dir = tmpDir();
    const tool = new ReadFileTool();
    const [result, , , isError] = await tool.run(makeContext(dir), { path: 'file\0.txt' });
    expect(isError).toBe(true);
    expect(result).toBe('Path contains invalid characters');
  });
});

// ── RunCommandTool tests ──────────────────────────────────────────────────────

describe('RunCommandTool', () => {
  it('runs a command and returns its stdout', async () => {
    const dir = tmpDir();
    const tool = new RunCommandTool();
    const [result] = await tool.run(makeContext(dir), { command: 'echo hello' });
    expect(result).toContain('hello');
  });

  it('runs command in the workspace directory', async () => {
    const dir = tmpDir();
    const tool = new RunCommandTool();
    const [result] = await tool.run(makeContext(dir), { command: 'pwd' });
    expect(result.trim()).toBe(dir);
  });

  it('returns "(no output)" for a command that produces no output', async () => {
    const dir = tmpDir();
    const tool = new RunCommandTool();
    const [result] = await tool.run(makeContext(dir), { command: 'true' });
    expect(result).toBe('(no output)');
  });

  it('returns error output for a failing command', async () => {
    const dir = tmpDir();
    const tool = new RunCommandTool();
    const [result] = await tool.run(makeContext(dir), { command: 'cat nonexistent_file_xyz' });
    expect(result.toLowerCase()).toContain('nonexistent_file_xyz');
  });

  it('returns "(no output)" when command fails with no output', async () => {
    const dir = tmpDir();
    const tool = new RunCommandTool();
    const [result] = await tool.run(makeContext(dir), { command: 'false' });
    expect(result).toBe('(no output)');
  });

  it('falls back to error message when stdout and stderr are absent on the thrown error', async () => {
    vi.mocked(childProcess.execSync as (...args: unknown[]) => string).mockImplementationOnce(() => {
      throw new Error('process failed unexpectedly');
    });
    const tool = new RunCommandTool();
    const [result] = await tool.run(makeContext(''), { command: 'something' });
    expect(result).toContain('process failed unexpectedly');
  });

  it('returns "(no output)" when stdout, stderr, and message are all absent on the thrown error', async () => {
    vi.mocked(childProcess.execSync as (...args: unknown[]) => string).mockImplementationOnce(() => {
      throw { code: 'ETIMEOUT' };
    });
    const tool = new RunCommandTool();
    const [result] = await tool.run(makeContext(''), { command: 'something' });
    expect(result).toBe('(no output)');
  });

  it('returns result flags [result, false, false, false]', async () => {
    const dir = tmpDir();
    const tool = new RunCommandTool();
    const [, isDoc, isInterrupt, isError] = await tool.run(makeContext(dir), { command: 'echo hi' });
    expect(isDoc).toBe(false);
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });
});

// ── FetchUrlTool tests ────────────────────────────────────────────────────────

describe('FetchUrlTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('strips HTML tags from the response body', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body><h1>Hello</h1><p>World</p></body></html>',
    } as unknown as Response);
    const tool = new FetchUrlTool();
    const [result] = await tool.run(makeContext(''), { url: 'https://example.com' });
    expect(result).not.toMatch(/<[^>]+>/);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('returns error message when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network error'));
    const tool = new FetchUrlTool();
    const [result] = await tool.run(makeContext(''), { url: 'https://example.com' });
    expect(result).toContain('Could not fetch https://example.com');
  });

  it('returns error with status and statusText for non-2xx responses', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'The page you requested could not be found.',
    } as unknown as Response);
    const tool = new FetchUrlTool();
    const [result] = await tool.run(makeContext(''), { url: 'https://example.com/missing' });
    expect(result).toContain('Could not fetch https://example.com/missing');
    expect(result).toContain('404');
    expect(result).toContain('Not Found');
    expect(result).toContain('The page you requested could not be found.');
  });

  it('omits body snippet from error when response body is empty', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => '   ',
    } as unknown as Response);
    const tool = new FetchUrlTool();
    const [result] = await tool.run(makeContext(''), { url: 'https://example.com' });
    expect(result).toContain('500');
    expect(result).not.toContain('—');
  });

  it('sets isDoc to true', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => 'content',
    } as unknown as Response);
    const tool = new FetchUrlTool();
    const [, isDoc] = await tool.run(makeContext(''), { url: 'https://example.com' });
    expect(isDoc).toBe(true);
  });

  it('sets isInterrupt and isError to false', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => 'content',
    } as unknown as Response);
    const tool = new FetchUrlTool();
    const [, , isInterrupt, isError] = await tool.run(makeContext(''), { url: 'https://example.com' });
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });
});

// ── AskUserTool tests ─────────────────────────────────────────────────────────

describe('AskUserTool', () => {
  it('returns placeholder for a general question', async () => {
    const tool = new AskUserTool();
    const [result] = await tool.run(makeContext(''), { question: 'What is the meaning of life?' });
    expect(result).toBe('(no answer provided)');
  });

  it('returns domain credential when question asks about domain', async () => {
    const tool = new AskUserTool();
    const [result] = await tool.run(makeContext('', { domain: 'example.auth0.com' }), {
      question: 'What is your Auth0 domain?',
    });
    expect(result).toBe('example.auth0.com');
  });

  it('returns domain credential when question mentions tenant', async () => {
    const tool = new AskUserTool();
    const [result] = await tool.run(makeContext('', { domain: 'mytenant.auth0.com' }), {
      question: 'What is your tenant name?',
    });
    expect(result).toBe('mytenant.auth0.com');
  });

  it('returns client_id credential when question asks about client id', async () => {
    const tool = new AskUserTool();
    const [result] = await tool.run(makeContext('', { client_id: 'abc123' }), {
      question: 'What is the client id?',
    });
    expect(result).toBe('abc123');
  });

  it('returns client_id credential when question mentions clientid', async () => {
    const tool = new AskUserTool();
    const [result] = await tool.run(makeContext('', { client_id: 'abc123' }), {
      question: 'Please provide the clientid',
    });
    expect(result).toBe('abc123');
  });

  it('returns client_id credential when question mentions client_id', async () => {
    const tool = new AskUserTool();
    const [result] = await tool.run(makeContext('', { client_id: 'abc123' }), {
      question: 'Enter the client_id value',
    });
    expect(result).toBe('abc123');
  });

  it('returns placeholder when credential is missing from context', async () => {
    const tool = new AskUserTool();
    const [result] = await tool.run(makeContext(''), { question: 'What is your domain?' });
    expect(result).toBe('(no answer provided)');
  });

  it('sets isInterrupt to true', async () => {
    const tool = new AskUserTool();
    const [, , isInterrupt] = await tool.run(makeContext(''), { question: 'What?' });
    expect(isInterrupt).toBe(true);
  });

  it('sets isDoc and isError to false', async () => {
    const tool = new AskUserTool();
    const [, isDoc, , isError] = await tool.run(makeContext(''), { question: 'What?' });
    expect(isDoc).toBe(false);
    expect(isError).toBe(false);
  });
});

// ── FinishTaskTool tests ──────────────────────────────────────────────────────

describe('FinishTaskTool', () => {
  it('returns "Task complete." when no summary is provided', async () => {
    const tool = new FinishTaskTool();
    const [result] = await tool.run(makeContext(''), {});
    expect(result).toBe('Task complete.');
  });

  it('returns the custom summary when provided', async () => {
    const tool = new FinishTaskTool();
    const [result] = await tool.run(makeContext(''), { summary: 'All done!' });
    expect(result).toBe('All done!');
  });

  it('returns result flags [result, false, false, false]', async () => {
    const tool = new FinishTaskTool();
    const [, isDoc, isInterrupt, isError] = await tool.run(makeContext(''), {});
    expect(isDoc).toBe(false);
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });
});

// ── ListSkillFilesTool tests ──────────────────────────────────────────────────

describe('ListSkillFilesTool', () => {
  let skillsBaseDir: string;

  async function importTool() {
    vi.resetModules();
    const { ListSkillFilesTool } = await import('../src/agent_eval/runners/react/tools/list-skill-files.js');
    return ListSkillFilesTool;
  }

  beforeEach(() => {
    const remoteDir = tmpDir();
    skillsBaseDir = join(remoteDir, 'auth0-skills', 'plugins', 'auth0', 'skills');
    mkdirSync(skillsBaseDir, { recursive: true });
    vi.stubEnv('SKILLS_REMOTE_DIR', remoteDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when skill argument is missing', async () => {
    const Tool = await importTool();
    await expect(new Tool().run(makeContext(''), {})).rejects.toThrow('list_skill_files requires a skill name');
  });

  it('throws when skill argument is empty string', async () => {
    const Tool = await importTool();
    await expect(new Tool().run(makeContext(''), { skill: '' })).rejects.toThrow(
      'list_skill_files requires a skill name',
    );
  });

  it('throws when skill argument is whitespace only', async () => {
    const Tool = await importTool();
    await expect(new Tool().run(makeContext(''), { skill: '   ' })).rejects.toThrow(
      'list_skill_files requires a skill name',
    );
  });

  it('returns access-denied message (isError=false) for path traversal', async () => {
    const Tool = await importTool();
    const [result, , , isError] = await new Tool().run(makeContext(''), { skill: '../../etc' });
    expect(result).toContain('Access denied');
    expect(isError).toBe(false);
  });

  it('returns skill-not-found message (isError=false) when skill does not exist', async () => {
    const Tool = await importTool();
    const [result, , , isError] = await new Tool().run(makeContext(''), { skill: 'nonexistent' });
    expect(result).toContain("Skill 'nonexistent' not found");
    expect(isError).toBe(false);
  });

  it('returns empty-directory message (isError=false) when skill directory is empty', async () => {
    mkdirSync(join(skillsBaseDir, 'myskill'), { recursive: true });
    const Tool = await importTool();
    const [result, , , isError] = await new Tool().run(makeContext(''), { skill: 'myskill' });
    expect(result).toContain('directory is empty');
    expect(isError).toBe(false);
  });

  it('returns file listing with isDoc=true and other flags false on success', async () => {
    const skillDir = join(skillsBaseDir, 'myskill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'skill content');
    const Tool = await importTool();
    const [result, isDoc, isInterrupt, isError] = await new Tool().run(makeContext(''), { skill: 'myskill' });
    expect(result).toContain('SKILL.md');
    expect(isDoc).toBe(true);
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });
});

// ── ReadSkillFileTool tests ───────────────────────────────────────────────────

describe('ReadSkillFileTool', () => {
  let skillsBaseDir: string;

  async function importTool() {
    vi.resetModules();
    const { ReadSkillFileTool } = await import('../src/agent_eval/runners/react/tools/read-skill-file.js');
    return ReadSkillFileTool;
  }

  beforeEach(() => {
    const remoteDir = tmpDir();
    skillsBaseDir = join(remoteDir, 'auth0-skills', 'plugins', 'auth0', 'skills');
    mkdirSync(skillsBaseDir, { recursive: true });
    vi.stubEnv('SKILLS_REMOTE_DIR', remoteDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when skill argument is missing', async () => {
    const Tool = await importTool();
    await expect(new Tool().run(makeContext(''), { path: 'SKILL.md' })).rejects.toThrow(
      'read_skill_file requires a skill name',
    );
  });

  it('throws when skill argument is whitespace only', async () => {
    const Tool = await importTool();
    await expect(new Tool().run(makeContext(''), { skill: '  ', path: 'SKILL.md' })).rejects.toThrow(
      'read_skill_file requires a skill name',
    );
  });

  it('throws when path argument is missing', async () => {
    mkdirSync(join(skillsBaseDir, 'myskill'), { recursive: true });
    const Tool = await importTool();
    await expect(new Tool().run(makeContext(''), { skill: 'myskill' })).rejects.toThrow(
      'read_skill_file requires a path',
    );
  });

  it('throws when path argument is whitespace only', async () => {
    mkdirSync(join(skillsBaseDir, 'myskill'), { recursive: true });
    const Tool = await importTool();
    await expect(new Tool().run(makeContext(''), { skill: 'myskill', path: '  ' })).rejects.toThrow(
      'read_skill_file requires a path',
    );
  });

  it('returns access-denied (isError=false) for skill path traversal', async () => {
    const Tool = await importTool();
    const [result, , , isError] = await new Tool().run(makeContext(''), { skill: '../../etc', path: 'passwd' });
    expect(result).toContain('Access denied');
    expect(isError).toBe(false);
  });

  it('returns access-denied (isError=false) for path traversal within skill', async () => {
    mkdirSync(join(skillsBaseDir, 'myskill'), { recursive: true });
    const Tool = await importTool();
    const [result, , , isError] = await new Tool().run(makeContext(''), {
      skill: 'myskill',
      path: '../../other/file.md',
    });
    expect(result).toContain('Access denied');
    expect(isError).toBe(false);
  });

  it('returns file-not-found (isError=false) when file does not exist', async () => {
    mkdirSync(join(skillsBaseDir, 'myskill'), { recursive: true });
    const Tool = await importTool();
    const [result, , , isError] = await new Tool().run(makeContext(''), { skill: 'myskill', path: 'missing.md' });
    expect(result).toContain('File not found: missing.md');
    expect(isError).toBe(false);
  });

  it('returns file content with isDoc=true and all other flags false on success', async () => {
    const skillDir = join(skillsBaseDir, 'myskill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'skill content here');
    const Tool = await importTool();
    const [result, isDoc, isInterrupt, isError] = await new Tool().run(makeContext(''), {
      skill: 'myskill',
      path: 'SKILL.md',
    });
    expect(result).toBe('skill content here');
    expect(isDoc).toBe(true);
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });
});

// ── collectFiles tests ────────────────────────────────────────────────────────

describe('collectFiles', () => {
  it('returns empty array when the root does not exist', () => {
    const result = collectFiles('/nonexistent_workspace_xyz', '/nonexistent_workspace_xyz');
    expect(result).toEqual([]);
  });

  it('includes a symlink that resolves to a file inside the workspace', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'real.txt'), '');
    symlinkSync(join(dir, 'real.txt'), join(dir, 'link.txt'));
    const result = collectFiles(dir, dir);
    expect(result).toContain('real.txt');
    expect(result).toContain('link.txt');
  });
});
