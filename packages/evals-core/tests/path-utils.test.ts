/**
 * Tests for workspace/path-utils.ts
 */

import { describe, it, expect } from 'vitest';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import { isPathInside, resolveInside, validatePathFormat } from '../src/workspace/path-utils.js';

const tmpDir = makeTmpDir('path_utils_test_');

// ── isPathInside tests ────────────────────────────────────────────────────────

describe('isPathInside', () => {
  it('returns true for exact match', () => {
    expect(isPathInside('/tmp/dir', '/tmp/dir')).toBe(true);
  });

  it('returns true for direct child', () => {
    expect(isPathInside('/tmp/dir', '/tmp/dir/file.txt')).toBe(true);
  });

  it('returns true for deeply nested path', () => {
    expect(isPathInside('/tmp/dir', '/tmp/dir/a/b/c.txt')).toBe(true);
  });

  it('returns false for sibling with same prefix', () => {
    // Ensures /tmp/dir_evil is not considered inside /tmp/dir
    expect(isPathInside('/tmp/dir', '/tmp/dir_evil/file.txt')).toBe(false);
  });

  it('returns false for parent directory', () => {
    expect(isPathInside('/tmp/dir', '/tmp')).toBe(false);
  });

  it('returns false for unrelated path', () => {
    expect(isPathInside('/tmp/dir', '/etc/passwd')).toBe(false);
  });
});

// ── resolveInside tests ───────────────────────────────────────────────────────

describe('resolveInside', () => {
  it('resolves an existing file to its canonical path', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'file.txt'), 'hello');
    const result = resolveInside(dir, 'file.txt');
    expect(result).toBe(join(dir, 'file.txt'));
  });

  it('throws on directory traversal', () => {
    const dir = tmpDir();
    expect(() => resolveInside(dir, '../../etc/passwd')).toThrow('path escapes directory');
  });

  it('resolves a non-existent file to a path within the directory', () => {
    const dir = tmpDir();
    const result = resolveInside(dir, 'new-file.ts');
    expect(isPathInside(dir, result)).toBe(true);
  });

  it('throws when a symlink escapes the directory', () => {
    const outside = tmpDir();
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    const dir = tmpDir();
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'link.txt'));
    expect(() => resolveInside(dir, 'link.txt')).toThrow('path escapes directory');
  });
});

// ── validatePathFormat tests ─────────────────────────────────────────────────

describe('validatePathFormat', () => {
  it('accepts a normal relative path', () => {
    expect(validatePathFormat('src/index.ts')).toBeNull();
  });

  it('accepts an empty string', () => {
    expect(validatePathFormat('')).toBeNull();
  });

  it('rejects paths containing null bytes', () => {
    expect(validatePathFormat('file\0.txt')).toBe('Path contains invalid characters');
  });

  it('rejects paths containing control characters', () => {
    expect(validatePathFormat('file\x01name')).toBe('Path contains invalid characters');
    expect(validatePathFormat('file\x1fname')).toBe('Path contains invalid characters');
    expect(validatePathFormat('file\x7fname')).toBe('Path contains invalid characters');
    expect(validatePathFormat('file\x80name')).toBe('Path contains invalid characters');
    expect(validatePathFormat('file\x9fname')).toBe('Path contains invalid characters');
  });

  it('rejects paths exceeding max length', () => {
    const longPath = 'a'.repeat(4097);
    const result = validatePathFormat(longPath);
    expect(result).toContain('Path too long');
  });

  it('accepts paths at exactly max length', () => {
    const maxPath = 'a'.repeat(4096);
    expect(validatePathFormat(maxPath)).toBeNull();
  });
});
