/**
 * Unit tests for IdentityTranslator.
 */

import { describe, it, expect } from 'vitest';
import { IdentityTranslator } from '../src/identity-translator.js';

describe('IdentityTranslator', () => {
  const translator = new IdentityTranslator();

  it('returns names unchanged', () => {
    expect(translator.mapName('read_file')).toBe('read_file');
    expect(translator.mapName('run_command')).toBe('run_command');
    expect(translator.mapName('anything')).toBe('anything');
  });

  it('returns args unchanged', () => {
    const args = { path: 'test.txt', content: 'hello' };
    expect(translator.normalizeArgs('read_file', args)).toEqual(args);
  });

  it('never classifies as doc lookup', () => {
    expect(translator.isDocLookup('fetch_url')).toBe(false);
    expect(translator.isDocLookup('anything')).toBe(false);
  });

  it('never classifies as interruption', () => {
    expect(translator.isInterruption('ask_user')).toBe(false);
    expect(translator.isInterruption('anything')).toBe(false);
  });
});

describe('IdentityTranslator — isInternalTool', () => {
  const translator = new IdentityTranslator();

  it('always returns false', () => {
    expect(translator.isInternalTool('TodoWrite')).toBe(false);
    expect(translator.isInternalTool('anything')).toBe(false);
  });
});
