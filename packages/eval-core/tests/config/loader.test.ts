/**
 * Tests for src/config/loader.ts — defineConfig, deepMerge, loadConfig.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { defineConfig, deepMerge, loadConfig } from '../../src/config/loader.js';
import { DEFAULT_FRAMEWORK_CONFIG } from '../../src/config/defaults.js';
import { EvalConfigError } from '../../src/errors.js';

// Fixtures live alongside this test file.
const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

// ── defineConfig ─────────────────────────────────────────────────────────────

describe('defineConfig', () => {
  it('returns the input unchanged', () => {
    const input = { evalsDir: 'my-evals' };
    expect(defineConfig(input)).toBe(input);
  });
});

// ── deepMerge ────────────────────────────────────────────────────────────────

describe('deepMerge', () => {
  it('returns a clone of target when source is empty', () => {
    const target = { a: 1, b: { c: 2 } };
    const result = deepMerge(target, {});
    expect(result).toEqual(target);
    expect(result).not.toBe(target);
  });

  it('merges nested objects recursively', () => {
    const target = { judge: { model: 'default', maxTokens: 1024 } };
    const source = { judge: { model: 'custom' } };
    const result = deepMerge(target, source);
    expect(result.judge.model).toBe('custom');
    expect(result.judge.maxTokens).toBe(1024);
  });

  it('replaces arrays instead of concatenating', () => {
    const target = { models: { known: ['a', 'b', 'c'] } };
    const source = { models: { known: ['x'] } };
    const result = deepMerge(target, source);
    expect(result.models.known).toEqual(['x']);
  });

  it('skips undefined values in source', () => {
    const target = { a: 'keep', b: 'keep' };
    const source = { a: undefined, b: 'override' };
    const result = deepMerge(target, source as Partial<typeof target>);
    expect(result.a).toBe('keep');
    expect(result.b).toBe('override');
  });

  it('replaces scalar values', () => {
    const target = { evalsDir: 'src/evals' };
    const source = { evalsDir: 'custom/evals' };
    const result = deepMerge(target, source);
    expect(result.evalsDir).toBe('custom/evals');
  });
});

// ── loadConfig ───────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig({ searchDir: FIXTURES_DIR + '/nonexistent' });
    expect(config).toEqual(DEFAULT_FRAMEWORK_CONFIG);
  });

  it('loads eval.config.js from searchDir', async () => {
    const config = await loadConfig({ searchDir: join(FIXTURES_DIR, 'valid') });
    expect(config.evalsDir).toBe('custom/evals');
    // Defaults are preserved for fields not in the config file.
    expect(config.judge.model).toBe('');
  });

  it('uses configPath override instead of auto-discovery', async () => {
    const config = await loadConfig({
      configPath: join(FIXTURES_DIR, 'override', 'my-config.js'),
    });
    expect(config.evalsDir).toBe('override/evals');
  });

  it('deep-merges user config with defaults', async () => {
    const config = await loadConfig({ searchDir: join(FIXTURES_DIR, 'partial-judge') });
    expect(config.judge.model).toBe('claude-opus-4-7');
    expect(config.judge.maxTokens).toBe(1024); // default preserved
  });

  it('throws EvalConfigError when configPath does not exist', async () => {
    await expect(loadConfig({ configPath: join(FIXTURES_DIR, 'does-not-exist.js') })).rejects.toThrow(EvalConfigError);
  });

  it('throws EvalConfigError when config file has syntax errors', async () => {
    const promise = loadConfig({ configPath: join(FIXTURES_DIR, 'broken', 'eval.config.js') });
    await expect(promise).rejects.toThrow(EvalConfigError);
    // The wrapped error preserves both the underlying import failure detail and the config path.
    await expect(promise).rejects.toThrow('Failed to load config:');
    await expect(promise).rejects.toThrow(join('broken', 'eval.config.js'));
  });

  it('includes the underlying cause in the error message for a broken config', async () => {
    // Regression: the loader used to discard the root cause and throw a bare
    // "Failed to load config: <path>", making misconfigured configs hard to
    // debug. The message must now surface the underlying parse/import error.
    await expect(loadConfig({ configPath: join(FIXTURES_DIR, 'broken', 'eval.config.js') })).rejects.toThrow(
      /Failed to load config: .*(parse|syntax|unexpected)/i,
    );
  });

  it('throws EvalConfigError when config has no default export', async () => {
    await expect(loadConfig({ configPath: join(FIXTURES_DIR, 'no-default', 'eval.config.js') })).rejects.toThrow(
      'must have a default export',
    );
  });

  it('throws EvalConfigError when export is not an object', async () => {
    await expect(loadConfig({ configPath: join(FIXTURES_DIR, 'non-object', 'eval.config.js') })).rejects.toThrow(
      EvalConfigError,
    );
  });
});
