import { describe, it, expect, expectTypeOf } from 'vitest';
import type { TenantConfigMethod } from '../src/index.js';
import { TENANT_CONFIG_INSTRUCTIONS } from '../src/index.js';

describe('TenantConfigMethod', () => {
  it('is the union terraform | cli', () => {
    expectTypeOf<TenantConfigMethod>().toEqualTypeOf<'terraform' | 'cli'>();
  });

  it('accepts terraform', () => {
    const m: TenantConfigMethod = 'terraform';
    expectTypeOf(m).toMatchTypeOf<TenantConfigMethod>();
  });

  it('accepts cli', () => {
    const m: TenantConfigMethod = 'cli';
    expectTypeOf(m).toMatchTypeOf<TenantConfigMethod>();
  });
});

describe('TENANT_CONFIG_INSTRUCTIONS', () => {
  it('maps each method to its instruction phrase', () => {
    expect(TENANT_CONFIG_INSTRUCTIONS.terraform).toBe('using Terraform');
    expect(TENANT_CONFIG_INSTRUCTIONS.cli).toBe(
      'using the Auth0 CLI (inspect current factors, enable the required factor, ' +
        'then enforce MFA via guardian/policies)',
    );
  });

  it('has an entry for every TenantConfigMethod', () => {
    expect(Object.keys(TENANT_CONFIG_INSTRUCTIONS).sort()).toEqual(['cli', 'terraform']);
  });
});
