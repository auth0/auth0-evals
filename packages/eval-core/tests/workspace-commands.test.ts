/**
 * Behavioral tests for workspace lifecycle helpers:
 * - runSetupCommand: executes shell commands in the workspace
 * - cleanupWorkspace: removes workspace directory
 * - setupWorkspace: additional edge cases not covered by workspace.test.ts
 */

import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import { setupWorkspace, runSetupCommand, runCompileCommand, cleanupWorkspace } from '../src/workspace/workspace.js';

const tmpDir = makeTmpDir('workspace_cmd_test_');

// ── runSetupCommand ───────────────────────────────────────────────────────────

describe('runSetupCommand', () => {
  it('executes a simple command in the workspace', () => {
    const dir = tmpDir();
    runSetupCommand(dir, 'touch created.txt');
    expect(existsSync(join(dir, 'created.txt'))).toBe(true);
  });

  it('runs command with multiple arguments', () => {
    const dir = tmpDir();
    runSetupCommand(dir, 'mkdir -p sub/nested');
    expect(existsSync(join(dir, 'sub/nested'))).toBe(true);
  });

  it('throws on empty command', () => {
    const dir = tmpDir();
    expect(() => runSetupCommand(dir, '')).toThrow('empty');
  });

  it('throws on whitespace-only command', () => {
    const dir = tmpDir();
    expect(() => runSetupCommand(dir, '   ')).toThrow('empty');
  });

  it('throws when command exits with non-zero code', () => {
    const dir = tmpDir();
    expect(() => runSetupCommand(dir, 'false')).toThrow('exit code');
  });

  it('throws when command is not found', () => {
    const dir = tmpDir();
    expect(() => runSetupCommand(dir, 'nonexistent_command_xyz')).toThrow();
  });

  it('runs in the correct working directory', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'marker.txt'), 'hello');
    // Use cat to read a file — proves cwd is set correctly
    runSetupCommand(dir, 'cat marker.txt');
    // If cwd was wrong, cat would fail and throw
  });

  it('respects custom timeout', () => {
    const dir = tmpDir();
    // sleep 10 with a 100ms timeout should be killed
    expect(() => runSetupCommand(dir, 'sleep 10', { timeoutMs: 100 })).toThrow();
  });

  it('runs &&-chained commands in order', () => {
    const dir = tmpDir();
    runSetupCommand(dir, 'mkdir -p sub && touch sub/second.txt');
    expect(existsSync(join(dir, 'sub/second.txt'))).toBe(true);
  });

  it('stops on first failure in &&-chained commands', () => {
    const dir = tmpDir();
    expect(() => runSetupCommand(dir, 'false && touch should_not_exist.txt')).toThrow('exit code');
    expect(existsSync(join(dir, 'should_not_exist.txt'))).toBe(false);
  });

  it('throws on empty segment in &&-chained command', () => {
    const dir = tmpDir();
    expect(() => runSetupCommand(dir, 'touch foo.txt &&')).toThrow('empty segment');
    expect(() => runSetupCommand(dir, 'touch foo.txt && && touch bar.txt')).toThrow('empty segment');
  });
});

// ── cleanupWorkspace ──────────────────────────────────────────────────────────

describe('cleanupWorkspace', () => {
  it('removes the workspace directory', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'file.txt'), 'data');
    cleanupWorkspace(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it('removes nested directory structures', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'a/b/c'), { recursive: true });
    writeFileSync(join(dir, 'a/b/c/deep.txt'), 'deep');
    cleanupWorkspace(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it('does not throw for non-existent directory', () => {
    expect(() => cleanupWorkspace('/tmp/nonexistent_dir_xyz_12345')).not.toThrow();
  });
});

// ── setupWorkspace — additional edge cases ────────────────────────────────────

describe('setupWorkspace — edge cases', () => {
  it('creates deeply nested scaffold directories', () => {
    const workspace = setupWorkspace({
      'a/b/c/d/e/deep.txt': 'deep content',
    });
    expect(readFileSync(join(workspace, 'a/b/c/d/e/deep.txt'), 'utf-8')).toBe('deep content');
    cleanupWorkspace(workspace);
  });

  it('handles empty scaffold', () => {
    const workspace = setupWorkspace({});
    expect(existsSync(workspace)).toBe(true);
    cleanupWorkspace(workspace);
  });

  it('sets nested gradlew as executable', () => {
    const workspace = setupWorkspace({ 'android/gradlew': '#!/bin/sh' });
    const mode = statSync(join(workspace, 'android/gradlew')).mode;
    expect(mode & 0o755).toBe(0o755);
    cleanupWorkspace(workspace);
  });
});

// ── runCompileCommand ─────────────────────────────────────────────────────────

describe('runCompileCommand', () => {
  it('returns ok:true with exit code 0 on success', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'true');
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.command).toBe('true');
  });

  it('returns ok:false WITHOUT throwing on non-zero exit', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'false');
    expect(res.ok).toBe(false);
    expect(res.exitCode).not.toBe(0);
  });

  it('captures combined stdout/stderr output', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'echo hello-build');
    expect(res.output).toContain('hello-build');
  });

  it('returns ok:false for a missing command without throwing', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'nonexistent_command_xyz');
    expect(res.ok).toBe(false);
  });

  it('short-circuits an &&-chain on first failure', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'false && touch should_not_exist.txt');
    expect(res.ok).toBe(false);
    expect(existsSync(join(dir, 'should_not_exist.txt'))).toBe(false);
  });

  it('returns ok:true when every sub-command in an &&-chain succeeds', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'mkdir sub && touch sub/built.txt');
    expect(res.ok).toBe(true);
    expect(existsSync(join(dir, 'sub/built.txt'))).toBe(true);
  });

  it('records the signal and ok:false on timeout', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'sleep 10', { timeoutMs: 100 });
    expect(res.ok).toBe(false);
    expect(res.signal).not.toBeNull();
  });

  it('returns ok:false for an empty command', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, '');
    expect(res.ok).toBe(false);
  });
});
