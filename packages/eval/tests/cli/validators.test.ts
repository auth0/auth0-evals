import { describe, it, expect, vi } from 'vitest';
import { validateTenantConfig } from '../../src/cli/validators.js';

describe('validateTenantConfig', () => {
  it('returns undefined when not provided', () => {
    expect(validateTenantConfig(undefined)).toBeUndefined();
  });

  it('accepts terraform and cli', () => {
    expect(validateTenantConfig('terraform')).toBe('terraform');
    expect(validateTenantConfig('cli')).toBe('cli');
  });

  it('exits on an invalid value', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    expect(() => validateTenantConfig('pulumi')).toThrow('exit');
    exit.mockRestore();
  });
});
