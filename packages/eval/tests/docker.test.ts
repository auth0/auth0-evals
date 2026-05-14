/**
 * Unit tests for Docker sandbox path validation and argument construction.
 *
 * These tests verify security-sensitive logic: workspace path validation,
 * Docker flag assembly, results parsing, and the ensureDockerImage concurrency gate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// ── Mock child_process so we never actually spawn Docker ─────────────────────

const mockExecFileSync = vi.fn();
const mockSpawn = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Reset the module-level imageReady promise between tests
beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  mockExecFileSync.mockReset();
  mockSpawn.mockReset();
});

// ── Shared helpers ───────────────────────────────────────────────────────────

async function getRunJobInDocker() {
  const mod = await import('../src/sandbox/docker.js');
  return mod.runJobInDocker;
}

function makeOptions(workspace: string) {
  return {
    workspace,
    evalId: 'test_eval',
    model: 'gpt-5.4',
    mode: 'agent' as const,
    tools: [] as string[],
    agentType: 'copilot' as const,
    apiKey: 'test-key',
  };
}

function extractEnvPairs(args: string[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-e') pairs.push(args[i + 1]);
  }
  return pairs;
}

function makeCloseEmitter(exitCode = 0) {
  const emitter = {
    on: (event: string, cb: (code: number) => void) => {
      if (event === 'close') setTimeout(() => cb(exitCode), 0);
      return emitter;
    },
  };
  return emitter;
}

// ── Workspace path validation ────────────────────────────────────────────────

describe('runJobInDocker — workspace path validation', () => {

  it('accepts a workspace under the OS temp directory', async () => {
    const runJobInDocker = await getRunJobInDocker();
    const workspace = mkdtempSync(join(tmpdir(), 'docker-test-'));

    // Mock ensureDockerImage (docker version + image inspect succeed)
    mockExecFileSync.mockReturnValue('');

    // Mock docker run to simulate a container that produces results
    const resultsPath = join(workspace, '.eval-results.json');
    mockSpawn.mockImplementation(() => {
      writeFileSync(resultsPath, JSON.stringify({ ok: true }));
      return makeCloseEmitter();
    });

    const result = await runJobInDocker(makeOptions(workspace));
    expect(result).toEqual({ ok: true });

    rmSync(workspace, { recursive: true, force: true });
  });

  it('rejects a workspace outside the OS temp directory', async () => {
    const runJobInDocker = await getRunJobInDocker();

    // Mock ensureDockerImage to succeed
    mockExecFileSync.mockReturnValue('');

    await expect(runJobInDocker(makeOptions('/etc/passwd'))).rejects.toThrow(
      'Workspace path must be under the system temp directory',
    );
  });

  it('rejects a workspace at the root', async () => {
    const runJobInDocker = await getRunJobInDocker();
    mockExecFileSync.mockReturnValue('');

    await expect(runJobInDocker(makeOptions('/'))).rejects.toThrow(
      'Workspace path must be under the system temp directory',
    );
  });

  it('resolves symlinks when validating workspace path', async () => {
    const runJobInDocker = await getRunJobInDocker();
    mockExecFileSync.mockReturnValue('');

    // Create a real temp dir and a symlink to it
    const realDir = mkdtempSync(join(tmpdir(), 'docker-real-'));
    const symlinkDir = join(tmpdir(), `docker-link-${Date.now()}`);
    symlinkSync(realDir, symlinkDir);

    // Mock docker run
    const resultsPath = join(realDir, '.eval-results.json');
    mockSpawn.mockImplementation(() => {
      writeFileSync(resultsPath, JSON.stringify({ ok: true }));
      return makeCloseEmitter();
    });

    // Symlink pointing to a valid temp dir should be accepted
    const result = await runJobInDocker(makeOptions(symlinkDir));
    expect(result).toEqual({ ok: true });

    rmSync(symlinkDir, { force: true });
    rmSync(realDir, { recursive: true, force: true });
  });

  it('rejects a symlink that resolves outside the temp directory', async () => {
    const runJobInDocker = await getRunJobInDocker();
    mockExecFileSync.mockReturnValue('');

    // Create a symlink in /tmp that points to /etc
    const symlinkDir = join(tmpdir(), `docker-evil-link-${Date.now()}`);
    try {
      symlinkSync('/etc', symlinkDir);

      await expect(runJobInDocker(makeOptions(symlinkDir))).rejects.toThrow(
        'Workspace path must be under the system temp directory',
      );
    } finally {
      rmSync(symlinkDir, { force: true });
    }
  });
});

// ── Docker argument construction ─────────────────────────────────────────────

describe('runJobInDocker — Docker argument construction', () => {
  it('passes security flags to docker run', async () => {
    const runJobInDocker = await getRunJobInDocker();
    const workspace = mkdtempSync(join(tmpdir(), 'docker-args-'));

    mockExecFileSync.mockReturnValue('');

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      const resultsPath = join(workspace, '.eval-results.json');
      writeFileSync(resultsPath, JSON.stringify({ ok: true }));
      return makeCloseEmitter();
    });

    await runJobInDocker({
      workspace,
      evalId: 'test_eval',
      model: 'gpt-5.4',
      mode: 'agent' as const,
      tools: ['skills'],
      agentType: 'auth0-ReAct-agent' as const,
      apiKey: 'test-key',
    });

    // Verify security flags
    expect(capturedArgs).toContain('--cap-drop=ALL');
    expect(capturedArgs).toContain('--cap-add=NET_ADMIN');
    expect(capturedArgs).toContain('--cap-add=SETUID');
    expect(capturedArgs).toContain('--cap-add=SETGID');
    expect(capturedArgs).toContain('--security-opt=no-new-privileges:true');
    expect(capturedArgs).toContain('--read-only');
    expect(capturedArgs).toContain('--pids-limit=512');
    expect(capturedArgs).toContain('--memory=4g');
    expect(capturedArgs).toContain('--cpus=2');
    expect(capturedArgs).toContain('--sysctl=net.ipv6.conf.all.disable_ipv6=1');
    expect(capturedArgs).toContain('--hostname=sandbox');
    expect(capturedArgs).toContain('--add-host=host.docker.internal:127.0.0.127');
    expect(capturedArgs).toContain('--rm');

    rmSync(workspace, { recursive: true, force: true });
  });

  it('passes eval parameters as environment variables', async () => {
    const runJobInDocker = await getRunJobInDocker();
    const workspace = mkdtempSync(join(tmpdir(), 'docker-env-'));

    mockExecFileSync.mockReturnValue('');

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      writeFileSync(join(workspace, '.eval-results.json'), JSON.stringify({ ok: true }));
      return makeCloseEmitter();
    });

    await runJobInDocker({
      workspace,
      evalId: 'react_quickstart',
      model: 'claude-sonnet-4-6',
      mode: 'agent' as const,
      tools: ['skills', 'mcp'],
      agentType: 'claude-code' as const,
      apiKey: 'sk-test-123',
      ghToken: 'gh-token-456',
    });

    // Find env flags by looking for -e flag pairs
    const envPairs = extractEnvPairs(capturedArgs);

    expect(envPairs).toContain('EVAL_ID=react_quickstart');
    expect(envPairs).toContain('MODEL=claude-sonnet-4-6');
    expect(envPairs).toContain('MODE=agent');
    expect(envPairs).toContain('TOOLS=skills,mcp');
    expect(envPairs).toContain('AGENT_TYPE=claude-code');
    expect(envPairs).toContain('ATKO_API_KEY=sk-test-123');
    expect(envPairs).toContain('GH_TOKEN=gh-token-456');
    expect(envPairs).toContain('CLAUDE_CODE_USE_BEDROCK_PROXY=0');

    rmSync(workspace, { recursive: true, force: true });
  });

  it('omits GH_TOKEN when not provided', async () => {
    const runJobInDocker = await getRunJobInDocker();
    const workspace = mkdtempSync(join(tmpdir(), 'docker-nogh-'));

    mockExecFileSync.mockReturnValue('');

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      writeFileSync(join(workspace, '.eval-results.json'), JSON.stringify({ ok: true }));
      return makeCloseEmitter();
    });

    await runJobInDocker({
      workspace,
      evalId: 'test_eval',
      model: 'gpt-5.4',
      mode: 'agent' as const,
      tools: [],
      agentType: 'auth0-ReAct-agent' as const,
      apiKey: 'test-key',
    });

    const envPairs = extractEnvPairs(capturedArgs);

    // Verify env wiring still works (positive assertion)
    expect(envPairs).toContain('ATKO_API_KEY=test-key');
    expect(envPairs.some((e) => e.startsWith('GH_TOKEN='))).toBe(false);

    rmSync(workspace, { recursive: true, force: true });
  });
});

// ── Results parsing ──────────────────────────────────────────────────────────

describe('runJobInDocker — results parsing', () => {
  function mockContainer(workspace: string, resultsContent?: string) {
    mockExecFileSync.mockReturnValue('');
    mockSpawn.mockImplementation(() => {
      if (resultsContent !== undefined) {
        writeFileSync(join(workspace, '.eval-results.json'), resultsContent);
      }
      return makeCloseEmitter();
    });
  }

  it('throws with exit code when container produces no results file', async () => {
    const runJobInDocker = await getRunJobInDocker();
    const workspace = mkdtempSync(join(tmpdir(), 'docker-noresults-'));

    mockContainer(workspace); // No results written, exits with code 0

    await expect(runJobInDocker(makeOptions(workspace))).rejects.toThrow('exit code: 0');

    rmSync(workspace, { recursive: true, force: true });
  });

  it('throws without exit code when container is killed by signal (null exit code)', async () => {
    const runJobInDocker = await getRunJobInDocker();
    const workspace = mkdtempSync(join(tmpdir(), 'docker-signalkill-'));

    mockExecFileSync.mockReturnValue('');
    mockSpawn.mockImplementation(() => makeCloseEmitter(null as unknown as number));

    await expect(runJobInDocker(makeOptions(workspace))).rejects.toThrow(
      'Container did not produce results.',
    );
    // Should NOT contain "(exit code:" when exit code is null
    await expect(runJobInDocker(makeOptions(workspace))).rejects.not.toThrow('exit code');

    rmSync(workspace, { recursive: true, force: true });
  });

  it('throws with clear message when results contain invalid JSON', async () => {
    const runJobInDocker = await getRunJobInDocker();
    const workspace = mkdtempSync(join(tmpdir(), 'docker-badjson-'));

    mockContainer(workspace, '{"truncated": ');

    await expect(runJobInDocker(makeOptions(workspace))).rejects.toThrow('Container produced invalid JSON results');

    rmSync(workspace, { recursive: true, force: true });
  });

  it('returns results when container exits non-zero but produced a results file', async () => {
    const runJobInDocker = await getRunJobInDocker();
    const workspace = mkdtempSync(join(tmpdir(), 'docker-nonzero-'));

    mockExecFileSync.mockReturnValue('');
    mockSpawn.mockImplementation((_cmd: string, _args: string[]) => {
      writeFileSync(join(workspace, '.eval-results.json'), JSON.stringify({ error: 'eval failed' }));
      return makeCloseEmitter(1);
    });

    const result = await runJobInDocker(makeOptions(workspace));
    expect(result).toEqual({ error: 'eval failed' });

    rmSync(workspace, { recursive: true, force: true });
  });
});

// ── Host-side timeout ────────────────────────────────────────────────────────

describe('runJobInDocker — host-side timeout', () => {
  it('sends SIGKILL after the deadline and rejects', async () => {
    const mod = await import('../src/sandbox/docker.js');
    const workspace = mkdtempSync(join(tmpdir(), 'docker-timeout-'));

    mockExecFileSync.mockReturnValue('');

    let killSignal: string | undefined;

    // Capture the deadline timer callback so we can fire it manually
    const timers: { cb: () => void; ms: number }[] = [];
    const origSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', (cb: () => void, ms?: number) => {
      if (ms && ms >= 60_000) {
        // This is the host deadline timer — capture it
        timers.push({ cb, ms });
        return 999 as unknown as NodeJS.Timeout;
      }
      // Let short timers (like makeCloseEmitter's) run normally
      return origSetTimeout(cb, ms ?? 0);
    });

    mockSpawn.mockImplementation(() => {
      let closeCallback: ((code: number | null) => void) | undefined;
      return {
        on: (event: string, cb: (arg: unknown) => void) => {
          if (event === 'close') closeCallback = cb as (code: number | null) => void;
        },
        kill: (signal: string) => {
          killSignal = signal;
          // Simulate: after SIGKILL, the process closes with code 137
          if (closeCallback) closeCallback(137);
        },
      };
    });

    const resultPromise = mod.runJobInDocker(makeOptions(workspace));

    // Allow microtasks to settle (ensureDockerImage resolves)
    await new Promise((r) => origSetTimeout(r, 0));

    // Fire the deadline timer
    const deadlineTimer = timers.find((t) => t.ms === 35 * 60_000);
    expect(deadlineTimer).toBeDefined();
    deadlineTimer!.cb();

    // The kill should have been called with SIGKILL
    expect(killSignal).toBe('SIGKILL');

    // Container didn't produce results, so it should throw
    await expect(resultPromise).rejects.toThrow('Container did not produce results');

    vi.unstubAllGlobals();
    rmSync(workspace, { recursive: true, force: true });
  });
});

// ── Spawn error handling ─────────────────────────────────────────────────────

describe('runJobInDocker — spawn error', () => {
  it('rejects when docker spawn emits error event', async () => {
    const mod = await import('../src/sandbox/docker.js');
    const workspace = mkdtempSync(join(tmpdir(), 'docker-spawnerr-'));

    mockExecFileSync.mockReturnValue('');

    mockSpawn.mockImplementation(() => {
      const emitter = {
        on: (event: string, cb: (arg: unknown) => void) => {
          if (event === 'error') setTimeout(() => cb(new Error('spawn ENOENT')), 0);
          return emitter;
        },
      };
      return emitter;
    });

    await expect(
      mod.runJobInDocker({
        workspace,
        evalId: 'test_eval',
        model: 'gpt-5.4',
        mode: 'agent' as const,
        tools: [] as string[],
        agentType: 'copilot' as const,
        apiKey: 'test-key',
      }),
    ).rejects.toThrow('spawn ENOENT');

    rmSync(workspace, { recursive: true, force: true });
  });
});

// ── ensureDockerImage — Docker not available ─────────────────────────────────

describe('ensureDockerImage — Docker not available', () => {
  it('rejects when Docker is not installed', async () => {
    const mod = await import('../src/sandbox/docker.js');

    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args && args[0] === 'version') {
        throw new Error('not found');
      }
      return '';
    });

    await expect(mod.ensureDockerImage()).rejects.toThrow('Docker is not available');
  });
});

// ── ensureDockerImage concurrency ────────────────────────────────────────────

describe('ensureDockerImage — concurrency', () => {
  it('only builds the image once when called concurrently', async () => {
    const mod = await import('../src/sandbox/docker.js');

    let buildCount = 0;
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args && args[0] === 'image' && args[1] === 'inspect') {
        throw new Error('not found');
      }
      if (args && args[0] === 'build') {
        buildCount++;
      }
      return '';
    });

    // Call concurrently
    await Promise.all([
      mod.ensureDockerImage('test-image'),
      mod.ensureDockerImage('test-image'),
      mod.ensureDockerImage('test-image'),
    ]);

    expect(buildCount).toBe(1);
  });

  it('retries after a build failure', async () => {
    const mod = await import('../src/sandbox/docker.js');

    let callCount = 0;
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args && args[0] === 'image' && args[1] === 'inspect') throw new Error('not found');
      if (args && args[0] === 'build') {
        callCount++;
        if (callCount === 1) throw new Error('transient build failure');
      }
      return '';
    });

    await expect(mod.ensureDockerImage('test-image')).rejects.toThrow('transient build failure');
    await expect(mod.ensureDockerImage('test-image')).resolves.toBeUndefined();
    expect(callCount).toBe(2);
  });
});

// ── CA cert volume mount ─────────────────────────────────────────────────────

describe('runJobInDocker — CA cert mount', () => {
  it('mounts NODE_EXTRA_CA_CERTS when set and file exists', async () => {
    const mod = await import('../src/sandbox/docker.js');
    const workspace = mkdtempSync(join(tmpdir(), 'docker-ca-'));

    // Create a fake CA cert file
    const caCertPath = join(workspace, 'ca-cert.pem');
    writeFileSync(caCertPath, 'fake-cert');

    // Set env var for the duration of this test
    const origEnv = process.env.NODE_EXTRA_CA_CERTS;
    process.env.NODE_EXTRA_CA_CERTS = caCertPath;

    mockExecFileSync.mockReturnValue('');

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      writeFileSync(join(workspace, '.eval-results.json'), JSON.stringify({ ok: true }));
      return makeCloseEmitter();
    });

    await mod.runJobInDocker({
      workspace,
      evalId: 'test_eval',
      model: 'gpt-5.4',
      mode: 'agent' as const,
      tools: [] as string[],
      agentType: 'copilot' as const,
      apiKey: 'test-key',
    });

    // Verify CA cert volume mount is present
    const volumeArg = capturedArgs.find((a) => a.includes('extra-ca-certificates.pem'));
    expect(volumeArg).toBeDefined();
    expect(volumeArg).toContain(':ro');

    // Verify NODE_EXTRA_CA_CERTS env var is passed to container
    const envPairs = extractEnvPairs(capturedArgs);
    expect(envPairs).toContain('NODE_EXTRA_CA_CERTS=/etc/ssl/certs/extra-ca-certificates.pem');
    expect(envPairs).toContain('GIT_SSL_CAINFO=/etc/ssl/certs/extra-ca-certificates.pem');

    // Restore
    if (origEnv === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = origEnv;
    rmSync(workspace, { recursive: true, force: true });
  });

  it('does not mount CA cert when NODE_EXTRA_CA_CERTS is not set', async () => {
    const mod = await import('../src/sandbox/docker.js');
    const workspace = mkdtempSync(join(tmpdir(), 'docker-noca-'));

    const origEnv = process.env.NODE_EXTRA_CA_CERTS;
    delete process.env.NODE_EXTRA_CA_CERTS;

    mockExecFileSync.mockReturnValue('');

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      writeFileSync(join(workspace, '.eval-results.json'), JSON.stringify({ ok: true }));
      return makeCloseEmitter();
    });

    await mod.runJobInDocker({
      workspace,
      evalId: 'test_eval',
      model: 'gpt-5.4',
      mode: 'agent' as const,
      tools: [] as string[],
      agentType: 'copilot' as const,
      apiKey: 'test-key',
    });

    // Verify workspace volume IS mounted (positive assertion that -v wiring works)
    const workspaceVolume = capturedArgs.find((a) => a.includes(':rw'));
    expect(workspaceVolume).toBeDefined();

    // Verify no CA cert volume mount
    const volumeArg = capturedArgs.find((a) => a.includes('extra-ca-certificates.pem'));
    expect(volumeArg).toBeUndefined();

    // Restore
    if (origEnv !== undefined) process.env.NODE_EXTRA_CA_CERTS = origEnv;
    rmSync(workspace, { recursive: true, force: true });
  });

  it('does not mount CA cert when NODE_EXTRA_CA_CERTS points to non-existent file', async () => {
    const mod = await import('../src/sandbox/docker.js');
    const workspace = mkdtempSync(join(tmpdir(), 'docker-ca-missing-'));

    const origEnv = process.env.NODE_EXTRA_CA_CERTS;
    process.env.NODE_EXTRA_CA_CERTS = '/tmp/does-not-exist-cert.pem';

    mockExecFileSync.mockReturnValue('');

    let capturedArgs: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      capturedArgs = args;
      writeFileSync(join(workspace, '.eval-results.json'), JSON.stringify({ ok: true }));
      return makeCloseEmitter();
    });

    await mod.runJobInDocker({
      workspace,
      evalId: 'test_eval',
      model: 'gpt-5.4',
      mode: 'agent' as const,
      tools: [] as string[],
      agentType: 'copilot' as const,
      apiKey: 'test-key',
    });

    // Verify workspace volume IS mounted (positive assertion that -v wiring works)
    const workspaceVolume = capturedArgs.find((a) => a.includes(':rw'));
    expect(workspaceVolume).toBeDefined();

    // Verify no CA cert volume mount when file doesn't exist
    const volumeArg = capturedArgs.find((a) => a.includes('extra-ca-certificates.pem'));
    expect(volumeArg).toBeUndefined();

    // Restore
    if (origEnv === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = origEnv;
    rmSync(workspace, { recursive: true, force: true });
  });
});
