import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles } from '../../src/graders/engine.js';
import { makeTmpDir } from '../tmp.js';

const tmpDir = makeTmpDir('walk_');

describe('walkFiles', () => {
  it('yields files recursively', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'sub', 'b.ts'), '');

    const files = [...walkFiles(dir)];
    expect(files).toContain(join(dir, 'a.ts'));
    expect(files).toContain(join(dir, 'sub', 'b.ts'));
  });

  it('excludes directories in EXCLUDED_EVAL_DIRS', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    mkdirSync(join(dir, '.claude'), { recursive: true });
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg.js'), '');
    writeFileSync(join(dir, '.claude', 'config.json'), '');
    writeFileSync(join(dir, 'dist', 'bundle.js'), '');
    writeFileSync(join(dir, 'app.ts'), '');

    const files = [...walkFiles(dir)];
    expect(files).toEqual([join(dir, 'app.ts')]);
  });

  it('excludes files in EXCLUDED_EVAL_FILES', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'package-lock.json'), '');
    writeFileSync(join(dir, 'tsconfig.tsbuildinfo'), '');
    writeFileSync(join(dir, 'index.ts'), '');

    const files = [...walkFiles(dir)];
    expect(files).toEqual([join(dir, 'index.ts')]);
  });

  it('returns empty for non-existent directory', () => {
    const dir = tmpDir();
    const files = [...walkFiles(join(dir, 'nonexistent'))];
    expect(files).toEqual([]);
  });
});
