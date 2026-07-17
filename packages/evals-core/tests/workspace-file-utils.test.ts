/**
 * Behavioral tests for collectFiles in workspace/file-utils.ts.
 *
 * Tests file collection, directory exclusion, symlink handling,
 * and truncation behavior using real filesystem operations.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTmpDir } from './tmp.js';
import { collectFiles, readWorkspaceFile } from '../src/workspace/file-utils.js';

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

// ── readWorkspaceFile ───────────────────────────────────────────────────────
//
// Deliberately does NOT use makeTmpDir (which realpath-resolves) — the symlink
// failure mode it guards against only appears with a workspace kept in its
// /var symlink form (macOS /var → /private/var) and with absolute paths like
// those Codex's apply_patch emits. A realpath-resolved workspace hides it.

describe('readWorkspaceFile', () => {
  const created: string[] = [];
  function makeWorkspace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ws_read_'));
    created.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of created) rmSync(d, { recursive: true, force: true });
    created.length = 0;
  });

  it('reads content via a relative path even when the workspace is a symlink', () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, '.env'), 'AUTH0_DOMAIN=dev-barkbook.us.auth0.com\nAUTH0_CLIENT_ID=abc123\n');

    const content = readWorkspaceFile(ws, '.env');
    expect(content).toContain('AUTH0_DOMAIN=dev-barkbook.us.auth0.com');
    expect(content).toContain('AUTH0_CLIENT_ID=abc123');
  });

  it('reads content via an absolute path in /var (symlink) form', () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, '.env'), 'AUTH0_SECRET=barkbook_secret_def456uvw\n');

    const absVar = join(ws, '.env');
    const content = readWorkspaceFile(ws, absVar);
    expect(content).toContain('AUTH0_SECRET=barkbook_secret_def456uvw');
  });

  it('reads content via an absolute path in canonical /private/var form', () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, 'src.txt'), 'hello world');

    const absReal = join(realpathSync(ws), 'src.txt');
    const content = readWorkspaceFile(ws, absReal);
    expect(content).toBe('hello world');
  });

  it('returns empty string for a path that escapes the workspace', () => {
    const outside = makeWorkspace();
    writeFileSync(join(outside, 'secret.txt'), 'top secret');
    const ws = makeWorkspace();

    expect(readWorkspaceFile(ws, join(outside, 'secret.txt'))).toBe('');
  });

  it('returns empty string when the file does not exist', () => {
    const ws = makeWorkspace();
    expect(readWorkspaceFile(ws, 'nope.txt')).toBe('');
  });
});
