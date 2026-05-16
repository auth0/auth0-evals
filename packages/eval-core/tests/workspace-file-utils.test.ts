/**
 * Behavioral tests for collectFiles in workspace/file-utils.ts.
 *
 * Tests file collection, directory exclusion, symlink handling,
 * and truncation behavior using real filesystem operations.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import { collectFiles } from '../src/workspace/file-utils.js';

const tmpDir = makeTmpDir('file_utils_test_');

// ── Basic collection ──────────────────────────────────────────────────────────

describe('collectFiles — basic', () => {
  it('collects files from a flat directory', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'a.ts'), 'a');
    writeFileSync(join(dir, 'b.ts'), 'b');
    const files = collectFiles(dir, dir);
    expect(files).toEqual(['a.ts', 'b.ts']);
  });

  it('collects files recursively', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'index.ts'), 'root');
    writeFileSync(join(dir, 'src/app.ts'), 'app');
    const files = collectFiles(dir, dir);
    expect(files).toContain('index.ts');
    expect(files).toContain('src/app.ts');
  });

  it('returns sorted results', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'z.ts'), '');
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'm.ts'), '');
    const files = collectFiles(dir, dir);
    expect(files).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });

  it('returns empty array for empty directory', () => {
    const dir = tmpDir();
    const files = collectFiles(dir, dir);
    expect(files).toEqual([]);
  });
});

// ── Directory exclusion ───────────────────────────────────────────────────────

describe('collectFiles — exclusion', () => {
  it('excludes node_modules by default', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'node_modules/dep'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/dep/index.js'), '');
    writeFileSync(join(dir, 'app.ts'), '');
    const files = collectFiles(dir, dir);
    expect(files).toEqual(['app.ts']);
  });

  it('excludes .next by default', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, '.next'), { recursive: true });
    writeFileSync(join(dir, '.next/cache.js'), '');
    writeFileSync(join(dir, 'app.ts'), '');
    const files = collectFiles(dir, dir);
    expect(files).toEqual(['app.ts']);
  });

  it('respects custom excludedDirs', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'vendor'));
    writeFileSync(join(dir, 'vendor/lib.js'), '');
    writeFileSync(join(dir, 'app.ts'), '');
    const files = collectFiles(dir, dir, { excludedDirs: new Set(['vendor']) });
    expect(files).toEqual(['app.ts']);
  });

  it('does not exclude directories not in the exclusion set', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/app.ts'), '');
    const files = collectFiles(dir, dir, { excludedDirs: new Set(['vendor']) });
    expect(files).toContain('src/app.ts');
  });
});

// ── Truncation ────────────────────────────────────────────────────────────────

describe('collectFiles — truncation', () => {
  it('truncates when maxFiles is exceeded', () => {
    const dir = tmpDir();
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(dir, `file${i}.ts`), '');
    }
    const files = collectFiles(dir, dir, { maxFiles: 3 });
    // 3 files + truncation message
    expect(files).toHaveLength(4);
    expect(files[3]).toContain('truncated');
  });

  it('does not truncate when within limit', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'b.ts'), '');
    const files = collectFiles(dir, dir, { maxFiles: 10 });
    expect(files).toEqual(['a.ts', 'b.ts']);
  });

  it('truncates at exactly maxFiles (>= check)', () => {
    const dir = tmpDir();
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, `f${i}.ts`), '');
    }
    const files = collectFiles(dir, dir, { maxFiles: 5 });
    // maxFiles=5 with 5 files triggers truncation (>= boundary)
    expect(files).toHaveLength(6);
    expect(files[5]).toContain('truncated');
  });

  it('does not truncate when file count is below maxFiles', () => {
    const dir = tmpDir();
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(dir, `f${i}.ts`), '');
    }
    const files = collectFiles(dir, dir, { maxFiles: 5 });
    expect(files).toEqual(['f0.ts', 'f1.ts', 'f2.ts', 'f3.ts']);
  });
});

// ── Symlink handling ──────────────────────────────────────────────────────────

describe('collectFiles — symlinks', () => {
  it('includes symlinked files that resolve within workspace', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'real.ts'), 'content');
    symlinkSync(join(dir, 'real.ts'), join(dir, 'link.ts'));
    const files = collectFiles(dir, dir);
    expect(files).toContain('link.ts');
    expect(files).toContain('real.ts');
  });

  it('excludes symlinked files that resolve outside workspace', () => {
    const outside = tmpDir();
    writeFileSync(join(outside, 'external.ts'), 'secret');
    const dir = tmpDir();
    writeFileSync(join(dir, 'local.ts'), 'ok');
    symlinkSync(join(outside, 'external.ts'), join(dir, 'escape.ts'));
    const files = collectFiles(dir, dir);
    expect(files).toContain('local.ts');
    expect(files).not.toContain('escape.ts');
  });

  it('skips symlinked directories', () => {
    const outside = tmpDir();
    mkdirSync(join(outside, 'sub'));
    writeFileSync(join(outside, 'sub/file.ts'), 'secret');
    const dir = tmpDir();
    symlinkSync(outside, join(dir, 'link-dir'));
    writeFileSync(join(dir, 'local.ts'), 'ok');
    const files = collectFiles(dir, dir);
    expect(files).toContain('local.ts');
    // Symlinked directory pointing outside should not be traversed
    expect(files.every((f) => !f.includes('link-dir'))).toBe(true);
  });
});
