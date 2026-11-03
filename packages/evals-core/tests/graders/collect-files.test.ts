import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectFiles, listGradingFiles } from '../../src/graders/engine.js';
import { logger } from '../../src/utils/logger.js';
import { makeTmpDir } from '../tmp.js';

const tmpDir = makeTmpDir('collect_');

describe('collectFiles', () => {
  it('keeps source files when excluded dirs hold more files than the listing cap', () => {
    // Mirrors a Nuxt workspace after `nuxt build`: injected skills under .claude/
    // plus hundreds of build chunks under .output/ sort ahead of app/ source.
    const dir = tmpDir();
    mkdirSync(join(dir, '.claude', 'skills'), { recursive: true });
    mkdirSync(join(dir, '.output', 'server', 'chunks'), { recursive: true });
    mkdirSync(join(dir, 'app', 'pages'), { recursive: true });
    for (let i = 0; i < 30; i++) writeFileSync(join(dir, '.claude', 'skills', `s${i}.md`), '');
    for (let i = 0; i < 250; i++) writeFileSync(join(dir, '.output', 'server', 'chunks', `c${i}.mjs`), '');
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
    writeFileSync(join(dir, 'app', 'pages', 'profile.vue'), '<template />');
    writeFileSync(join(dir, 'nuxt.config.ts'), 'export default defineNuxtConfig({})');

    expect(Object.keys(collectFiles(dir))).toEqual(['.gitignore', 'app/pages/profile.vue', 'nuxt.config.ts']);
  });

  it('excludes EXCLUDED_EVAL_DIRS at any depth and EXCLUDED_EVAL_FILES', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'web', '.output'), { recursive: true });
    writeFileSync(join(dir, 'web', '.output', 'index.mjs'), '');
    writeFileSync(join(dir, 'web', 'app.ts'), 'x');
    writeFileSync(join(dir, 'CLAUDE.md'), '');

    expect(collectFiles(dir)).toEqual({ 'web/app.ts': 'x' });
  });

  it('prunes Gradle output (.gradle/, build/) but keeps build.gradle', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, '.gradle', 'caches'), { recursive: true });
    mkdirSync(join(dir, 'android', 'app', 'build', 'intermediates'), { recursive: true });
    writeFileSync(join(dir, '.gradle', 'caches', 'file.bin'), '');
    writeFileSync(join(dir, 'android', 'app', 'build', 'intermediates', 'classes.dex'), '');
    writeFileSync(join(dir, 'android', 'app', 'build.gradle'), 'android {}');

    expect(Object.keys(collectFiles(dir))).toEqual(['android/app/build.gradle']);
  });

  it('caps the listing at 200 kept files and warns when it truncates', () => {
    const dir = tmpDir();
    for (let i = 0; i < 205; i++) writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.ts`), '');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const { files, truncated } = listGradingFiles(dir);
      expect(truncated).toBe(true);
      expect(files).toHaveLength(200);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('truncated at 200 files'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not count EXCLUDED_EVAL_FILES toward the cap', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'AGENTS.md'), '');
    for (let i = 0; i < 199; i++) writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.ts`), '');

    expect(listGradingFiles(dir)).toMatchObject({ truncated: false });
    expect(listGradingFiles(dir).files).toHaveLength(199);
  });
});
