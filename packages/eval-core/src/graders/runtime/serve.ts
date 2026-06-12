/**
 * Starts the app's serve command in a given directory and waits until the
 * declared port accepts TCP connections. Returns a handle that kills the whole
 * process group on stop (dev servers spawn children).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';

export interface ServeHandle {
  /** Kills the server process tree. Safe to call multiple times. */
  stop: () => Promise<void>;
}

export interface StartServerOptions {
  /** Max time to wait for the port to open. Default 60_000. */
  timeoutMs?: number;
  /** Poll interval. Default 250. */
  pollMs?: number;
}

function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startServer(
  cwd: string,
  serveCommand: string,
  port: number,
  options: StartServerOptions = {},
): Promise<ServeHandle> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollMs ?? 250;

  // detached:true so we can kill the whole process group (dev servers fork children).
  const child: ChildProcess = spawn('sh', ['-c', serveCommand], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });

  const stop = async (): Promise<void> => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGKILL'); // negative pid → process group
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
  };

  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return { stop };
    if (exited) break;
    await delay(pollMs);
  }

  await stop();
  throw new Error(`serve_command never opened port ${port} within ${timeoutMs}ms`);
}
