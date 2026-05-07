/**
 * Tests for all tools in the React runner.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';

import { setFrameworkConfig, resetSkillsManager, DEFAULT_FRAMEWORK_CONFIG } from '@a0/eval-core';
import type { FrameworkConfig } from '@a0/eval-core';

// Initialize the framework config singleton so internal @a0/eval functions work correctly.
setFrameworkConfig(DEFAULT_FRAMEWORK_CONFIG as Required<FrameworkConfig>);

import { ToolExecutor } from '../src/tools-executor/index.js';

const tmpDir = makeTmpDir('tools_test_');

// ── ToolExecutor.write_file tests ─────────────────────────────────────────────

describe('ToolExecutor.write_file', () => {
  it('writes a file within the workspace', async () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('write_file', { path: 'output.txt', content: 'hello' });
    expect(result).toContain('Written');
    expect(result).toContain('output.txt');
  });

  it('rejects path traversal', async () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('write_file', { path: '../../evil.txt', content: 'bad' });
    expect(result).toContain('Access denied');
  });

  it('rejects symlink pointing outside workspace', async () => {
    const outside = tmpDir();
    writeFileSync(join(outside, 'target.txt'), 'original');
    const dir = tmpDir();
    symlinkSync(join(outside, 'target.txt'), join(dir, 'link.txt'));
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('write_file', { path: 'link.txt', content: 'overwrite' });
    expect(result).toContain('Access denied');
  });
});

// ── ToolExecutor._read_file safety tests ─────────────────────────────────────

describe('ToolExecutor.read_file', () => {
  it('rejects path traversal', async () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('read_file', { path: '../../etc/passwd' });
    expect(result).toContain('Access denied');
  });

  it('returns error for directory', async () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'src'));
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('read_file', { path: 'src' });
    expect(result).toContain('list_files');
  });

  it('returns error for workspace root', async () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('read_file', { path: '' });
    expect(result).toContain('list_files');
  });
});

// ── ToolExecutor.list_files tests ─────────────────────────────────────────────

describe('ToolExecutor.list_files', () => {
  it('rejects path traversal', async () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('list_files', { path: '../../etc' });
    expect(result).toContain('Access denied');
  });

  it('returns directory listing for subdir', async () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'export {}');
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('list_files', { path: 'src' });
    expect(result).toContain('Directory listing');
    expect(result).toContain('src/index.ts');
  });

  it('returns listing for workspace root', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'README.md'), '# hello');
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('list_files', { path: '' });
    expect(result).toContain('Directory listing');
    expect(result).toContain('README.md');
  });

  it('returns error for file path', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'main.py'), "print('hi')");
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('list_files', { path: 'main.py' });
    expect(result).toContain('read_file');
  });

  it('returns error for missing directory', async () => {
    const dir = tmpDir();
    const executor = new ToolExecutor(dir);
    const [result] = await executor.execute('list_files', { path: 'nonexistent' });
    expect(result.toLowerCase()).toContain('not found');
  });
});

// ── ToolExecutor.list_skill_files tests ───────────────────────────────────────

describe('ToolExecutor.list_skill_files', () => {
  let skillsBaseDir: string;

  beforeEach(() => {
    skillsBaseDir = tmpDir();
    resetSkillsManager();
    setFrameworkConfig({
      ...DEFAULT_FRAMEWORK_CONFIG,
      skills: { remoteRepos: [], localDirs: [skillsBaseDir] },
    } as Required<FrameworkConfig>);
  });

  afterEach(() => {
    resetSkillsManager();
    setFrameworkConfig(DEFAULT_FRAMEWORK_CONFIG as Required<FrameworkConfig>);
  });

  it('returns execution error (isError=true) when skill argument is missing', async () => {
    const [result, , , isError] = await new ToolExecutor(tmpDir()).execute('list_skill_files', {});
    expect(result).toContain('Error executing list_skill_files');
    expect(isError).toBe(true);
  });

  it('returns access-denied (isError=false) for path traversal', async () => {
    const [result, , , isError] = await new ToolExecutor(tmpDir()).execute('list_skill_files', { skill: '../../etc' });
    expect(result).toContain('Access denied');
    expect(isError).toBe(false);
  });

  it('returns skill-not-found (isError=false) for unknown skill', async () => {
    const [result, , , isError] = await new ToolExecutor(tmpDir()).execute('list_skill_files', {
      skill: 'nonexistent',
    });
    expect(result).toContain('not found');
    expect(isError).toBe(false);
  });

  it('returns file listing with isDoc=true and isError=false on success', async () => {
    const skillDir = join(skillsBaseDir, 'myskill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'skill content');
    const [result, isDoc, isInterrupt, isError] = await new ToolExecutor(tmpDir()).execute('list_skill_files', {
      skill: 'myskill',
    });
    expect(result).toContain('SKILL.md');
    expect(isDoc).toBe(true);
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });
});

// ── ToolExecutor.read_skill_file tests ────────────────────────────────────────

describe('ToolExecutor.read_skill_file', () => {
  let skillsBaseDir: string;

  beforeEach(() => {
    skillsBaseDir = tmpDir();
    // Point the SkillsManager at our temp directory
    resetSkillsManager();
    setFrameworkConfig({
      ...DEFAULT_FRAMEWORK_CONFIG,
      skills: { remoteRepos: [], localDirs: [skillsBaseDir] },
    } as Required<FrameworkConfig>);
  });

  afterEach(() => {
    // Restore default config
    resetSkillsManager();
    setFrameworkConfig(DEFAULT_FRAMEWORK_CONFIG as Required<FrameworkConfig>);
  });

  it('returns execution error (isError=true) when skill argument is missing', async () => {
    const [result, , , isError] = await new ToolExecutor(tmpDir()).execute('read_skill_file', { path: 'SKILL.md' });
    expect(result).toContain('Error executing read_skill_file');
    expect(isError).toBe(true);
  });

  it('returns execution error (isError=true) when path argument is missing', async () => {
    mkdirSync(join(skillsBaseDir, 'myskill'), { recursive: true });
    const [result, , , isError] = await new ToolExecutor(tmpDir()).execute('read_skill_file', { skill: 'myskill' });
    expect(result).toContain('Error executing read_skill_file');
    expect(isError).toBe(true);
  });

  it('returns access-denied (isError=false) for skill path traversal', async () => {
    const [result, , , isError] = await new ToolExecutor(tmpDir()).execute('read_skill_file', {
      skill: '../../etc',
      path: 'passwd',
    });
    expect(result).toContain('Access denied');
    expect(isError).toBe(false);
  });

  it('returns access-denied (isError=false) for path traversal within skill', async () => {
    mkdirSync(join(skillsBaseDir, 'myskill'), { recursive: true });
    const [result, , , isError] = await new ToolExecutor(tmpDir()).execute('read_skill_file', {
      skill: 'myskill',
      path: '../../other/file.md',
    });
    expect(result).toContain('Access denied');
    expect(isError).toBe(false);
  });

  it('returns file-not-found (isError=false) for missing file', async () => {
    mkdirSync(join(skillsBaseDir, 'myskill'), { recursive: true });
    const [result, , , isError] = await new ToolExecutor(tmpDir()).execute('read_skill_file', {
      skill: 'myskill',
      path: 'missing.md',
    });
    expect(result).toContain('File not found: missing.md');
    expect(isError).toBe(false);
  });

  it('returns file content with isDoc=true and isError=false on success', async () => {
    const skillDir = join(skillsBaseDir, 'myskill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), 'skill content here');
    const [result, isDoc, isInterrupt, isError] = await new ToolExecutor(tmpDir()).execute('read_skill_file', {
      skill: 'myskill',
      path: 'SKILL.md',
    });
    expect(result).toBe('skill content here');
    expect(isDoc).toBe(true);
    expect(isInterrupt).toBe(false);
    expect(isError).toBe(false);
  });
});
