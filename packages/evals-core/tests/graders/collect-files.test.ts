import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectFiles } from '../../src/graders/engine.js';
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
});
