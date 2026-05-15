/**
 * Tests for utils/env.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { filteredEnv } from '../src/utils/env.js';

describe('filteredEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env after each test.
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it('includes PATH and HOME when set', () => {
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/user';

    const env = filteredEnv();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/user');
  });

  it('includes platform-specific keys when set', () => {
    if (process.platform === 'win32') {
      process.env.SYSTEMROOT = 'C:\\Windows';
      process.env.USERPROFILE = 'C:\\Users\\test';
      process.env.TEMP = 'C:\\Temp';
      process.env.TMP = 'C:\\Temp';
      const winEnv = filteredEnv();
      expect(winEnv.SYSTEMROOT).toBe('C:\\Windows');
      expect(winEnv.USERPROFILE).toBe('C:\\Users\\test');
      expect(winEnv.TEMP).toBe('C:\\Temp');
      expect(winEnv.TMP).toBe('C:\\Temp');
    } else {
      process.env.TMPDIR = '/tmp';
      process.env.USER = 'testuser';
      process.env.SHELL = '/bin/zsh';
      const posixEnv = filteredEnv();
      expect(posixEnv.TMPDIR).toBe('/tmp');
      expect(posixEnv.USER).toBe('testuser');
      expect(posixEnv.SHELL).toBe('/bin/zsh');
    }
  });

  it('excludes sensitive variables like API keys', () => {
    process.env.ATKO_API_KEY = 'test-api-key-12345678';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-12345678';
    process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
    process.env.DATABASE_URL = 'postgres://user:pass@host/db';

    const env = filteredEnv();
    expect(env).not.toHaveProperty('ATKO_API_KEY');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(env).not.toHaveProperty('DATABASE_URL');
  });

  it('excludes arbitrary unknown variables', () => {
    process.env.MY_CUSTOM_VAR = 'value';
    process.env.SOME_TOKEN = 'token123';

    const env = filteredEnv();
    expect(env).not.toHaveProperty('MY_CUSTOM_VAR');
    expect(env).not.toHaveProperty('SOME_TOKEN');
  });

  it('omits allowed keys that are not set', () => {
    delete process.env.HOME;

    const env = filteredEnv();
    expect(env).not.toHaveProperty('HOME');
  });

  it('preserves allowed keys that are set to empty string', () => {
    process.env.TERM = '';
    process.env.PATH = '';

    const env = filteredEnv();
    expect(env).toHaveProperty('TERM', '');
    expect(env).toHaveProperty('PATH', '');
  });

  it('includes NODE_OPTIONS when set', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=4096';

    const env = filteredEnv();
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=4096');
  });

  it('excludes runner-specific vars that must be merged explicitly', () => {
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
    process.env.CLAUDE_CODE_USE_BEDROCK_PROXY = '0';
    process.env.GH_TOKEN = 'test-gh-token-12345678';

    const env = filteredEnv();
    expect(env).not.toHaveProperty('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS');
    expect(env).not.toHaveProperty('CLAUDE_CODE_USE_BEDROCK_PROXY');
    expect(env).not.toHaveProperty('GH_TOKEN');
  });

  it('finds mixed-case keys and preserves their original casing', () => {
    // Simulate Windows-style mixed-case env var names.
    // Delete uppercase first, then set mixed-case.
    delete process.env.LANG;
    process.env.Lang = 'en_US.UTF-8';

    const env = filteredEnv();
    // Should find the value via case-insensitive lookup
    expect(Object.values(env)).toContain('en_US.UTF-8');
    // Should preserve the original mixed-case key, not our uppercase allowlist key
    expect(env).toHaveProperty('Lang', 'en_US.UTF-8');
    expect(env).not.toHaveProperty('LANG');

    // Clean up
    delete process.env.Lang;
  });
});
