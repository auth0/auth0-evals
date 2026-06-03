import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import {
  setupWorkspace,
  cleanupWorkspace,
  writeAgentGuidance,
  AGENT_GUIDANCE,
  AGENT_CONTEXT_FILENAMES,
} from '../src/workspace/workspace.js';
import { resolveInside } from '../src/workspace/path-utils.js';

const tmpDir = makeTmpDir('workspace_test_');

describe('setupWorkspace - path traversal protection', () => {
  it('writes valid scaffold files to the workspace', () => {
    const workspace = setupWorkspace({
      'index.js': 'console.log("hello");',
      'src/app.ts': 'export default {};',
    });

    expect(existsSync(join(workspace, 'index.js'))).toBe(true);
    expect(readFileSync(join(workspace, 'index.js'), 'utf-8')).toBe('console.log("hello");');
    expect(existsSync(join(workspace, 'src/app.ts'))).toBe(true);
    expect(readFileSync(join(workspace, 'src/app.ts'), 'utf-8')).toBe('export default {};');

    cleanupWorkspace(workspace);
  });

  it('skips files with ../ traversal paths', () => {
    const workspace = setupWorkspace({
      'safe.txt': 'allowed',
      '../escape.txt': 'should be skipped',
      '../../etc/passwd': 'should be skipped',
    });

    expect(existsSync(join(workspace, 'safe.txt'))).toBe(true);
    expect(readFileSync(join(workspace, 'safe.txt'), 'utf-8')).toBe('allowed');
    expect(existsSync(join(workspace, '..', 'escape.txt'))).toBe(false);

    cleanupWorkspace(workspace);
  });

  it('skips files with embedded traversal in subdirectories', () => {
    const workspace = setupWorkspace({
      'src/../../../etc/shadow': 'should be skipped',
      'src/valid.ts': 'ok',
    });

    expect(existsSync(join(workspace, 'src/valid.ts'))).toBe(true);
    expect(existsSync(join(workspace, '..', 'etc', 'shadow'))).toBe(false);

    cleanupWorkspace(workspace);
  });

  it('writes all valid files even when some are invalid', () => {
    const workspace = setupWorkspace({
      'a.txt': 'first',
      '../bad.txt': 'traversal',
      'b.txt': 'second',
      '../../worse.txt': 'traversal',
      'c.txt': 'third',
    });

    expect(readFileSync(join(workspace, 'a.txt'), 'utf-8')).toBe('first');
    expect(readFileSync(join(workspace, 'b.txt'), 'utf-8')).toBe('second');
    expect(readFileSync(join(workspace, 'c.txt'), 'utf-8')).toBe('third');

    cleanupWorkspace(workspace);
  });

  it('sets gradlew as executable', () => {
    const workspace = setupWorkspace({ gradlew: '#!/bin/sh' });
    const mode = statSync(join(workspace, 'gradlew')).mode;
    expect(mode & 0o755).toBe(0o755);

    cleanupWorkspace(workspace);
  });
});

describe('writeAgentGuidance - runner-aware context file', () => {
  it('does not write any context file in setupWorkspace itself', () => {
    const workspace = setupWorkspace({ 'index.js': 'ok' });

    expect(existsSync(join(workspace, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(workspace, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(workspace, 'GEMINI.md'))).toBe(false);

    cleanupWorkspace(workspace);
  });

  it.each([
    ['claude-code', 'CLAUDE.md'],
    ['gemini-cli', 'GEMINI.md'],
    ['codex', 'AGENTS.md'],
    ['copilot', '.github/copilot-instructions.md'],
  ] as const)('writes guidance to %s context file %s', (agentType, filename) => {
    const workspace = setupWorkspace({ 'index.js': 'ok' });
    writeAgentGuidance(workspace, agentType);

    expect(AGENT_CONTEXT_FILENAMES[agentType]).toBe(filename);
    expect(readFileSync(join(workspace, filename), 'utf-8')).toBe(AGENT_GUIDANCE);

    cleanupWorkspace(workspace);
  });

  it('appends to an existing context file, preserving its content', () => {
    const workspace = setupWorkspace({ 'CLAUDE.md': 'Scaffold guidance.\n' });
    writeAgentGuidance(workspace, 'claude-code');

    const content = readFileSync(join(workspace, 'CLAUDE.md'), 'utf-8');
    expect(content.startsWith('Scaffold guidance.\n')).toBe(true);
    expect(content.endsWith(AGENT_GUIDANCE)).toBe(true);

    cleanupWorkspace(workspace);
  });
});

describe('resolveInside - symlink escape protection', () => {
  it('rejects a path that traverses through a symlink pointing outside the workspace', () => {
    const workspace = tmpDir();
    const outside = tmpDir();
    writeFileSync(join(outside, 'secret.txt'), 'sensitive');

    // Create a symlink inside the workspace pointing to the outside directory
    symlinkSync(outside, join(workspace, 'link'));

    // resolveInside should reject because link/secret.txt resolves to outside/secret.txt
    expect(() => resolveInside(workspace, 'link/secret.txt')).toThrow('path escapes directory');
  });

  it('rejects a symlinked file pointing outside the workspace', () => {
    const workspace = tmpDir();
    const outside = tmpDir();
    writeFileSync(join(outside, 'target.txt'), 'secret');

    // Symlink a file (not directory) to outside
    symlinkSync(join(outside, 'target.txt'), join(workspace, 'escape.txt'));

    expect(() => resolveInside(workspace, 'escape.txt')).toThrow('path escapes directory');
  });

  it('allows a symlink that stays within the workspace', () => {
    const workspace = tmpDir();
    mkdirSync(join(workspace, 'real'));
    writeFileSync(join(workspace, 'real', 'file.txt'), 'ok');

    // Internal symlink — should be allowed
    symlinkSync(join(workspace, 'real'), join(workspace, 'alias'));

    const resolved = resolveInside(workspace, 'alias/file.txt');
    expect(resolved).toBe(join(workspace, 'real', 'file.txt'));
  });
});
