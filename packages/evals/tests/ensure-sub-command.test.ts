import { describe, it, expect } from 'vitest';
import { ensureSubCommand } from '../src/cli/ensure-sub-command.js';

describe('ensureSubCommand', () => {
  it('passes through when "run" sub-command is present', () => {
    const argv = ['node', 'bin.js', 'run', '--eval', 'foo'];
    expect(ensureSubCommand(argv)).toEqual(argv);
  });

  it('passes through when "report" sub-command is present', () => {
    const argv = ['node', 'bin.js', 'report', '--output', 'out.html'];
    expect(ensureSubCommand(argv)).toEqual(argv);
  });

  it('inserts "run" when first arg is a flag', () => {
    const argv = ['node', 'bin.js', '--eval', 'foo', '--model', 'gpt-5.4'];
    expect(ensureSubCommand(argv)).toEqual(['node', 'bin.js', 'run', '--eval', 'foo', '--model', 'gpt-5.4']);
  });

  it('passes through unchanged when no args are present', () => {
    const argv = ['node', 'bin.js'];
    expect(ensureSubCommand(argv)).toEqual(argv);
  });

  it('passes through --help unchanged', () => {
    const argv = ['node', 'bin.js', '--help'];
    expect(ensureSubCommand(argv)).toEqual(argv);
  });

  it('passes through -h unchanged', () => {
    const argv = ['node', 'bin.js', '-h'];
    expect(ensureSubCommand(argv)).toEqual(argv);
  });
});
