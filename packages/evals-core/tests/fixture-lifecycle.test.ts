/**
 * Tests for src/fixture/lifecycle.ts
 */

import { describe, it, expect, vi } from 'vitest';
import type { FixtureContext, FixtureDef, ManagementApi } from '@a0/evals-graders';
import { openFixture } from '../src/fixture/lifecycle.js';

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function fakeMgmt(): ManagementApi {
  return { domain: 'acme.auth0.com', request: vi.fn(), get: vi.fn() } as unknown as ManagementApi;
}

const opts = () => ({ mgmt: fakeMgmt(), workspace: '/tmp/ws', runId: 'run12345' });

describe('openFixture', () => {
  it('uses the seed return value as context.seeded', async () => {
    const session = await openFixture({ seed: async () => ({ clientId: 'abc' }) } as FixtureDef, opts());
    expect(session.context.seeded).toEqual({ clientId: 'abc' });
  });

  it('defaults seeded to {} when seed returns undefined', async () => {
    const session = await openFixture({ seed: async () => undefined } as unknown as FixtureDef, opts());
    expect(session.context.seeded).toEqual({});
  });

  it('uses the runId override', async () => {
    const session = await openFixture({} as FixtureDef, opts());
    expect(session.context.runId).toBe('run12345');
  });

  it('defaults runId to 8 hex chars', async () => {
    const rest = opts();
    delete rest.runId;
    const session = await openFixture({} as FixtureDef, rest);
    expect(session.context.runId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('runs seed before the pre snapshot and snapshot() calls the hook again', async () => {
    const calls: string[] = [];
    let n = 0;
    const def = {
      seed: vi.fn(async () => {
        calls.push('seed');
        return { s: 1 };
      }),
      snapshot: vi.fn(async () => {
        calls.push('snapshot');
        return { n: ++n };
      }),
    } as unknown as FixtureDef;

    const session = await openFixture(def, opts());
    expect(calls).toEqual(['seed', 'snapshot']);
    expect(session.pre).toEqual({ n: 1 });

    const post = await session.snapshot();
    expect(post).toEqual({ n: 2 });
    expect(def.snapshot).toHaveBeenCalledTimes(2);
  });

  it('has undefined pre and snapshot() resolves undefined without a snapshot hook', async () => {
    const session = await openFixture({ seed: async () => ({}) } as FixtureDef, opts());
    expect(session.pre).toBeUndefined();
    await expect(session.snapshot()).resolves.toBeUndefined();
  });

  it('runs cleanup once and rethrows the original error when seed throws', async () => {
    const err = new Error('seed boom');
    const cleanup = vi.fn(async () => {});
    const def = {
      seed: async () => {
        throw err;
      },
      cleanup,
    } as unknown as FixtureDef;

    await expect(openFixture(def, opts())).rejects.toBe(err);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('runs cleanup and rejects when the pre snapshot throws', async () => {
    const err = new Error('snap boom');
    const cleanup = vi.fn(async () => {});
    const def = {
      seed: async () => ({ a: 1 }),
      snapshot: async () => {
        throw err;
      },
      cleanup,
    } as unknown as FixtureDef;

    await expect(openFixture(def, opts())).rejects.toBe(err);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('close() runs cleanup exactly once even when called twice', async () => {
    const cleanup = vi.fn(async () => {});
    const session = await openFixture({ cleanup } as unknown as FixtureDef, opts());
    await session.close();
    await session.close();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('close() resolves when cleanup throws', async () => {
    const cleanup = vi.fn(async () => {
      throw new Error('cleanup boom');
    });
    const session = await openFixture({ cleanup } as unknown as FixtureDef, opts());
    await expect(session.close()).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('close() resolves without a cleanup hook', async () => {
    const session = await openFixture({} as FixtureDef, opts());
    await expect(session.close()).resolves.toBeUndefined();
  });

  it('passes mgmt, workspace, runId and populated seeded to hooks', async () => {
    const o = opts();
    const seen: Record<string, FixtureContext> = {};
    const def = {
      seed: async (ctx: FixtureContext) => {
        seen.seed = { ...ctx };
        return { id: 'seeded-1' };
      },
      snapshot: async (ctx: FixtureContext) => {
        seen.snapshot = ctx;
      },
      cleanup: async (ctx: FixtureContext) => {
        seen.cleanup = ctx;
      },
    } as unknown as FixtureDef;

    const session = await openFixture(def, o);
    await session.snapshot();
    await session.close();

    expect(seen.seed.seeded).toEqual({});
    for (const hook of ['snapshot', 'cleanup']) {
      expect(seen[hook].mgmt).toBe(o.mgmt);
      expect(seen[hook].workspace).toBe('/tmp/ws');
      expect(seen[hook].runId).toBe('run12345');
      expect(seen[hook].seeded).toEqual({ id: 'seeded-1' });
    }
  });

  it('collects secrets registered during seed into session.secrets', async () => {
    const def = {
      seed: async (ctx: FixtureContext) => {
        ctx.registerSecret('s3cr3t-one');
        ctx.registerSecret('s3cr3t-two');
        return {};
      },
    } as unknown as FixtureDef;
    const session = await openFixture(def, opts());
    expect(session.secrets).toEqual(['s3cr3t-one', 's3cr3t-two']);
  });

  it('defaults to no secrets', async () => {
    expect((await openFixture({} as FixtureDef, opts())).secrets).toEqual([]);
  });

  it('accepts a value of exactly 8 characters', async () => {
    const def = {
      seed: async (ctx: FixtureContext) => {
        ctx.registerSecret('12345678');
        return {};
      },
    } as unknown as FixtureDef;
    expect((await openFixture(def, opts())).secrets).toEqual(['12345678']);
  });

  it.each(['', 'short', '1234567'])('throws for the too-short value %j without echoing it', async (value) => {
    let thrown: Error | undefined;
    const def = {
      seed: async (ctx: FixtureContext) => {
        try {
          ctx.registerSecret(value);
        } catch (e) {
          thrown = e as Error;
        }
        return {};
      },
    } as unknown as FixtureDef;
    const session = await openFixture(def, opts());
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain('at least 8');
    if (value) expect(thrown!.message).not.toContain(value);
    expect(session.secrets).toEqual([]);
  });

  it('fails the seed (and runs cleanup) when it lets a too-short registerSecret throw', async () => {
    const cleanup = vi.fn(async () => {});
    const def = {
      seed: async (ctx: FixtureContext) => {
        ctx.registerSecret('tiny');
        return {};
      },
      cleanup,
    } as unknown as FixtureDef;
    await expect(openFixture(def, opts())).rejects.toThrow(/at least 8/);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
