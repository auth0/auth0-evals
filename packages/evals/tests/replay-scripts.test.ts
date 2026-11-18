/**
 * Tests for replayScript and replayScripts: the order of the post snapshot and the compile command,
 * masking of known secrets in what replay prints, and keeping going after a script that cannot run.
 *
 * The core framework is mocked, so no tenant, no LLM and no real fixture are involved. The steps
 * themselves are real `bash -c` calls on a trivial script.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalDefinition, VerifierCredentials } from '@a0/evals-core';
import { makeTmpDir } from './tmp.js';

const SECRET = 'verifier-secret-98765';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  openFixture: vi.fn(),
  runCompileCommand: vi.fn(),
  runGraders: vi.fn(),
  capturePost: vi.fn(),
  close: vi.fn(),
  workspace: '',
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@a0/evals-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@a0/evals-core')>()),
  logger: mocks.logger,
  setupWorkspace: () => mocks.workspace,
  cleanupWorkspace: vi.fn(),
  createManagementClient: vi.fn(),
  openFixture: mocks.openFixture,
  runSetupCommand: vi.fn(),
  runCompileCommand: mocks.runCompileCommand,
  runGraders: mocks.runGraders,
}));

const { replayScript, replayScripts } = await import('../src/cli/replay.js');

const tmp = makeTmpDir('replay_scripts_');
const CREDENTIALS = { domain: 'x.auth0.com', clientId: 'cid', clientSecret: SECRET } as VerifierCredentials;

function evalDef(overrides: Partial<EvalDefinition> = {}): EvalDefinition {
  return {
    id: 'sample_cli',
    scaffold: undefined,
    fixture: {},
    graders: [{ kind: 'contains', name: 'g' }],
    compileCommand: 'npm run build',
    ...overrides,
  } as unknown as EvalDefinition;
}

function session() {
  return {
    context: { runId: 'run1', seeded: {} },
    gradingInput: () => ({ secrets: [SECRET], state: undefined }),
    capturePost: mocks.capturePost,
    close: mocks.close,
  };
}

function allLogged(): string {
  return Object.values(mocks.logger)
    .flatMap((fn) => fn.mock.calls.flat())
    .join('\n');
}

describe('replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.workspace = tmp();
    mocks.openFixture.mockImplementation(async () => session());
    mocks.capturePost.mockImplementation(async () => {
      mocks.order.push('capturePost');
    });
    mocks.runCompileCommand.mockImplementation(() => {
      mocks.order.push('compile');
      return { ok: true, command: 'npm run build', output: '' };
    });
    mocks.runGraders.mockResolvedValue([{ name: 'g', kind: 'contains', passed: true, detail: 'ok' }]);
  });

  describe('replayScript', () => {
    it('takes the post snapshot before the compile command, like a real run', async () => {
      await replayScript(evalDef(), CREDENTIALS, { steps: ['true'], breaks: [] });
      expect(mocks.order).toEqual(['capturePost', 'compile']);
    });

    it('masks a known secret in the compile output before the graders see it', async () => {
      mocks.runCompileCommand.mockReturnValue({
        ok: false,
        command: 'npm run build',
        exitCode: 1,
        output: `build failed, token=${SECRET}`,
      });

      await replayScript(evalDef(), CREDENTIALS, { steps: ['true'], breaks: [] });

      const compileArg = mocks.runGraders.mock.calls[0]![7] as { output: string };
      expect(compileArg.output).not.toContain(SECRET);
      expect(compileArg.output).toContain('[REDACTED SECRET]');
    });

    it('masks a secret that the post snapshot registered, which only exists after capturePost', async () => {
      const LATE = 'registered-late-secret-4321';
      let registered = false;
      mocks.openFixture.mockImplementation(async () => ({
        ...session(),
        gradingInput: () => ({ secrets: registered ? [SECRET, LATE] : [SECRET], state: undefined }),
      }));
      mocks.capturePost.mockImplementation(async () => {
        registered = true;
      });
      mocks.runCompileCommand.mockReturnValue({ ok: false, command: 'build', exitCode: 1, output: `leaked ${LATE}` });
      mocks.runGraders.mockResolvedValue([
        { name: 'compiles', kind: 'compile', passed: false, detail: `failed: ${LATE}` },
      ]);

      const { results } = await replayScript(evalDef(), CREDENTIALS, { steps: ['true'], breaks: [] });

      expect((mocks.runGraders.mock.calls[0]![7] as { output: string }).output).not.toContain(LATE);
      expect(results[0]!.detail).not.toContain(LATE);
    });

    it('masks a registered secret by exact value in an error from the post snapshot', async () => {
      // A plain value like this is not caught by pattern redaction, only by exact match.
      mocks.capturePost.mockRejectedValue(new Error(`snapshot failed for ${SECRET}`));

      const err = (await replayScript(evalDef(), CREDENTIALS, { steps: ['true'], breaks: [] }).catch(
        (e: unknown) => e,
      )) as Error;

      expect(err).toBeInstanceOf(Error);
      expect(String(err)).not.toContain(SECRET);
      expect(err.message).toBe('snapshot failed for [REDACTED SECRET]');
      expect(mocks.close).toHaveBeenCalledTimes(1);
    });

    it('masks the verifier secret in an error that happens before a session exists', async () => {
      mocks.openFixture.mockRejectedValue(new Error(`seed failed for ${SECRET}`));

      const err = (await replayScript(evalDef(), CREDENTIALS, { steps: ['true'], breaks: [] }).catch(
        (e: unknown) => e,
      )) as Error;

      expect(err.message).toBe('seed failed for [REDACTED SECRET]');
    });

    it('masks a known secret in the grader details it returns', async () => {
      mocks.runGraders.mockResolvedValue([
        { name: 'compiles', kind: 'compile', passed: false, detail: `failed: ${SECRET}` },
      ]);

      const { results } = await replayScript(evalDef(), CREDENTIALS, { steps: ['true'], breaks: [] });

      expect(results[0]!.detail).not.toContain(SECRET);
      expect(results[0]!.detail).toContain('[REDACTED SECRET]');
    });
  });

  describe('replayScripts', () => {
    function script(name: string): string {
      const path = join(tmp(), `${name}.sh`);
      writeFileSync(path, 'true\n');
      return path;
    }

    it('keeps going after a script that cannot run, reports it masked, and returns false', async () => {
      mocks.openFixture
        .mockRejectedValueOnce(new Error(`seed failed for ${SECRET}`))
        .mockImplementation(async () => session());

      const ok = await replayScripts(evalDef(), CREDENTIALS, [
        { label: 'mutant broken', kind: 'mutant', path: script('broken') },
        { label: 'reference', kind: 'reference', path: script('reference') },
      ]);

      expect(ok).toBe(false);
      // The second script still ran and got its own verdict.
      expect(mocks.openFixture).toHaveBeenCalledTimes(2);
      expect(allLogged()).toContain('✓ reference: all graders passed');
      expect(allLogged()).toContain('mutant broken');
      expect(mocks.logger.error).toHaveBeenCalledTimes(1);
      const errorLine = String(mocks.logger.error.mock.calls[0]![0]);
      expect(errorLine).toContain('mutant broken');
      expect(errorLine).toContain('seed failed for [REDACTED SECRET]');
      expect(errorLine).not.toContain(SECRET);
    });

    it('never prints a known secret from grader details', async () => {
      mocks.runGraders.mockResolvedValue([
        { name: 'compiles', kind: 'compile', passed: true, detail: `output ${SECRET}` },
      ]);

      await replayScripts(evalDef(), CREDENTIALS, [{ label: 'reference', kind: 'reference', path: script('r') }]);

      expect(allLogged()).not.toContain(SECRET);
      expect(allLogged()).toContain('PASS  compiles');
    });

    it('returns true when every script gets its expected verdict', async () => {
      const ok = await replayScripts(evalDef(), CREDENTIALS, [
        { label: 'reference', kind: 'reference', path: script('reference') },
      ]);
      expect(ok).toBe(true);
    });
  });
});
