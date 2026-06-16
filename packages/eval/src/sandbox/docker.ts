/**
 * Docker container lifecycle for sandboxed eval runs.
 *
 * Spawns a container with the workspace bind-mounted, waits for the job
 * to complete, then reads the results JSON from the workspace.
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '@a0/eval-core';
import type { JobResult, AgentType, Mode } from '@a0/eval-core';
import { DOCKER_IMAGE_NAME, DOCKER_WORKSPACE_MOUNT, LLM_API_KEY_ENV, SANDBOX_RESULTS_FILE } from '../cli/constants.js';

export interface DockerRunOptions {
  /** Absolute host path to the workspace directory. */
  workspace: string;
  /** Eval ID to run. */
  evalId: string;
  /** Model identifier. */
  model: string;
  /** Execution mode (always 'agent' for sandbox runs). */
  mode: Mode;
  /** Tool list (e.g. ['skills', 'mcp']). */
  tools: string[];
  /** Agent runner type. */
  agentType: AgentType;
  /** API key for LLM proxy. */
  apiKey: string;
  /** Optional GitHub token (for copilot runner). */
  ghToken?: string;
  /**
   * Names of host env vars to forward into the container (from `sandbox.passthroughEnv`).
   * Each is resolved from `process.env` here; only currently-set vars are forwarded.
   */
  passthroughEnv?: string[];
}

// Serialises concurrent ensureDockerImage calls so only one build runs at a time.
let imageReady: Promise<void> | null = null;

/**
 * Checks whether the Docker image exists locally. If not, builds it automatically.
 * Safe to call concurrently — only the first caller triggers the build; the rest await it.
 * Throws if Docker is not available or the build fails.
 */
export function ensureDockerImage(imageName: string = DOCKER_IMAGE_NAME): Promise<void> {
  if (!imageReady) {
    imageReady = ensureDockerImageOnce(imageName).catch((err) => {
      imageReady = null; // Allow retry on transient failures
      throw err;
    });
  }
  return imageReady;
}

function ensureDockerImageOnce(imageName: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Check if Docker is available
    try {
      execFileSync('docker', ['version'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      reject(
        new Error(`Docker is not available.\n` + `Install Docker or skip sandboxing with: --dangerously-skip-sandbox`),
      );
      return;
    }

    // Check if image exists
    try {
      execFileSync('docker', ['image', 'inspect', imageName], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      resolve();
      return;
    } catch {
      // Image not found — build it
    }

    logger.info(`[sandbox] Docker image "${imageName}" not found — building...`);
    try {
      execFileSync('docker', ['build', '-f', 'docker/Dockerfile', '-t', imageName, '.'], {
        cwd: findRepoRoot(),
        encoding: 'utf-8',
        stdio: 'inherit',
        timeout: 600_000, // 10 minutes max for build
      });
      logger.info(`[sandbox] Docker image "${imageName}" built successfully`);
      resolve();
    } catch (e) {
      reject(
        new Error(
          `Failed to build Docker image "${imageName}".\n` +
            `Try building manually: docker build -f docker/Dockerfile -t auth0-evals:latest .\n` +
            `Or skip sandboxing with: --dangerously-skip-sandbox\n` +
            `Error: ${e}`,
        ),
      );
    }
  });
}

/** Walks up from cwd to find the monorepo root (has docker/Dockerfile). */
function findRepoRoot(): string {
  let dir = process.cwd();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(dir, 'docker', 'Dockerfile'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  throw new Error('Could not find monorepo root (looking for docker/Dockerfile)');
}

/**
 * Runs an eval job inside a Docker container and returns the result.
 *
 * The workspace is bind-mounted read-write. The container writes its result
 * to `.eval-results.json` inside the workspace. This function reads that file
 * after the container exits.
 */
export async function runJobInDocker(options: DockerRunOptions): Promise<JobResult> {
  const { workspace, evalId, model, mode, tools, agentType, apiKey, ghToken, passthroughEnv } = options;

  await ensureDockerImage();

  // Validate workspace is under the OS temp directory to prevent mounting arbitrary host paths
  // Use realpathSync on both to handle macOS symlinks (/var → /private/var)
  const resolvedWorkspace = realpathSync(resolve(workspace));
  const resolvedTmp = realpathSync(tmpdir());
  if (!resolvedWorkspace.startsWith(resolvedTmp + '/')) {
    throw new Error(
      `Workspace path must be under the system temp directory (${resolvedTmp}).\n` + `Got: ${resolvedWorkspace}`,
    );
  }

  const envFlags: string[] = [
    '-e',
    `EVAL_ID=${evalId}`,
    '-e',
    `MODEL=${model}`,
    '-e',
    `MODE=${mode}`,
    '-e',
    `TOOLS=${tools.join(',')}`,
    '-e',
    `AGENT_TYPE=${agentType}`,
    '-e',
    `${LLM_API_KEY_ENV}=${apiKey}`,
    '-e',
    `WORKSPACE=${DOCKER_WORKSPACE_MOUNT}`,
  ];

  if (ghToken) {
    envFlags.push('-e', `GH_TOKEN=${ghToken}`);
  }

  // Forward app-declared passthrough env vars (e.g. MCP server credentials).
  // Only vars currently set on the host are forwarded; missing ones are skipped.
  for (const name of passthroughEnv ?? []) {
    const value = process.env[name];
    if (value !== undefined) {
      envFlags.push('-e', `${name}=${value}`);
    }
  }

  // Mount host CA certificates for corporate SSL inspection (MITM proxies)
  // Use resolvedWorkspace (canonicalized) to ensure we mount the same path we validated
  const volumeFlags: string[] = ['-v', `${resolvedWorkspace}:${DOCKER_WORKSPACE_MOUNT}:rw`];
  const hostCaCert = process.env.NODE_EXTRA_CA_CERTS;

  const securityFlags: string[] = [
    '--cap-drop=ALL',
    '--cap-add=NET_ADMIN', // Required for iptables rules in entrypoint; cleared via setpriv --inh-caps=-all
    '--cap-add=SETUID', // Required for setpriv to drop to node user
    '--cap-add=SETGID', // Required for setpriv to set groups when dropping user
    '--security-opt=no-new-privileges:true',
    '--read-only',
    '--tmpfs=/tmp:size=2g',
    '--tmpfs=/home/node:size=1g,uid=1000,gid=1000',
    '--tmpfs=/app/skills-remote:size=256m,uid=1000,gid=1000',
    '--pids-limit=512',
    '--memory=6g',
    '--cpus=2',
    // Disable IPv6 to prevent bypassing IPv4 iptables rules via IPv6 link-local/private ranges
    '--sysctl=net.ipv6.conf.all.disable_ipv6=1',
    // Override host.docker.internal to resolve to container loopback instead of the host
    '--add-host=host.docker.internal:127.0.0.127',
    '--hostname=sandbox',
  ];

  if (hostCaCert && existsSync(hostCaCert)) {
    const resolvedCa = realpathSync(hostCaCert);
    const containerCaPath = '/etc/ssl/certs/extra-ca-certificates.pem';
    volumeFlags.push('-v', `${resolvedCa}:${containerCaPath}:ro`);
    envFlags.push('-e', `NODE_EXTRA_CA_CERTS=${containerCaPath}`);
    // Mount tmpfs over /etc/ssl/certs so entrypoint can restore the system bundle
    // (from /etc/ssl/certs.bak) and append the extra CA cert. Required because
    // rustls-native-certs reads ca-certificates.crt directly and cannot be
    // redirected via env vars, and --read-only blocks writes without this tmpfs.
    securityFlags.push('--tmpfs=/etc/ssl/certs:size=16m');
    logger.info(`[sandbox] Mounting CA cert: ${resolvedCa} → ${containerCaPath}`);
  }

  const dockerArgs = ['run', '--rm', ...securityFlags, ...volumeFlags, ...envFlags, DOCKER_IMAGE_NAME];

  // Host-side deadline: kills the container if it hasn't exited within 35 minutes.
  const HOST_TIMEOUT_MS = 35 * 60_000; // 35 minutes

  logger.info(`[sandbox] Starting container for ${evalId}/${model} (${agentType})`);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn('docker', dockerArgs, { stdio: 'inherit' });

    const deadline = setTimeout(() => {
      logger.warn(`[sandbox] Host-side timeout (${HOST_TIMEOUT_MS / 60_000}min) — killing container`);
      child.kill('SIGKILL');
    }, HOST_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(deadline);
      resolve(code);
    });
    child.on('error', (err) => {
      clearTimeout(deadline);
      reject(err);
    });
  });

  // Read results from workspace (use canonicalized path consistent with the bind mount)
  const resultsPath = join(resolvedWorkspace, SANDBOX_RESULTS_FILE);

  if (!existsSync(resultsPath)) {
    const exitInfo = exitCode !== null ? ` (exit code: ${exitCode})` : '';
    throw new Error(`Container did not produce results${exitInfo}. Check container logs above.`);
  }

  const resultJson = readFileSync(resultsPath, 'utf-8');
  rmSync(resultsPath, { force: true });

  let result: JobResult;
  try {
    result = JSON.parse(resultJson) as JobResult;
  } catch {
    throw new Error(
      `Container produced invalid JSON results (${resultJson.length} bytes). ` +
        `The process may have been killed mid-write.`,
    );
  }

  if (exitCode !== 0 && exitCode !== null) {
    logger.warn(`[sandbox] Container exited with code ${exitCode} but produced results`);
  }

  logger.info(`[sandbox] Job complete: ${evalId}/${model}`);
  return result;
}
