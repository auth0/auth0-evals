/**
 * Grader executor: runtime
 *
 * Spins up the agent's built app in a throwaway copy (with fake Auth0 values
 * swapped for real ones), launches a headless browser, and runs the eval's
 * per-eval Playwright script. Maps the outcome to a GraderResult and always
 * tears down (server, browser, copy).
 *
 * Browser/serve/script-loading are injected (see RuntimeDeps) so unit tests can
 * exercise the orchestration without a real browser. `runtimeExecutor` is the
 * production instance wired to real implementations.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GraderDef, GraderResult, RuntimeContext, RuntimeScript, RuntimeTestUser } from '@a0/eval-graders';
import type { GraderContext, GraderExecutor } from './types.js';
import { prepareRuntimeWorkspace } from '../runtime/prepare-workspace.js';
import { startServer, type ServeHandle } from '../runtime/serve.js';

/** A minimal browser handle the executor needs. */
export interface RuntimeBrowser {
  page: RuntimeContext['page'];
  close: () => Promise<void>;
}

export interface RuntimeDeps {
  serve: (cwd: string, serveCommand: string, port: number) => Promise<ServeHandle>;
  launchBrowser: () => Promise<RuntimeBrowser>;
  loadScript: (scriptPath: string) => Promise<RuntimeScript>;
}

function fail(def: GraderDef, detail: string): GraderResult {
  return { name: def.name, kind: def.kind, passed: false, detail, level: def.level };
}

export function makeRuntimeExecutor(deps: RuntimeDeps): GraderExecutor {
  return {
    kind: 'runtime',

    async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
      const rt = ctx.runtime;
      if (!rt) {
        return fail(
          def,
          'runtime grading requires serve_command, serve_port, runtime_swap and RUNTIME_* env vars — none resolved',
        );
      }
      if (!def.scriptPath) {
        return fail(def, 'runtime grader missing scriptPath');
      }

      const baseURL = `http://localhost:${rt.servePort}`;
      const testUser: RuntimeTestUser = rt.testUser;

      const prepared = prepareRuntimeWorkspace(ctx.workspace, rt.swap);
      let server: ServeHandle | undefined;
      let browser: RuntimeBrowser | undefined;

      try {
        server = await deps.serve(prepared.copyPath, rt.serveCommand, rt.servePort);
        browser = await deps.launchBrowser();
        const script = await deps.loadScript(join(rt.evalDir, def.scriptPath));
        const outcome = await script({ page: browser.page, baseURL, testUser });
        return {
          name: def.name,
          kind: def.kind,
          passed: outcome.passed,
          detail: outcome.detail,
          level: def.level,
        };
      } catch (err) {
        return fail(def, err instanceof Error ? err.message : String(err));
      } finally {
        if (browser) await browser.close().catch(() => {});
        if (server) await server.stop().catch(() => {});
        prepared.cleanup();
      }
    },
  };
}

// ── Production dependencies ────────────────────────────────────────────────────

const realDeps: RuntimeDeps = {
  serve: (cwd, serveCommand, port) => startServer(cwd, serveCommand, port),
  launchBrowser: async () => {
    const { chromium } = await import('playwright');
    const browserInstance = await chromium.launch({ headless: true });
    const context = await browserInstance.newContext();
    const page = await context.newPage();
    return {
      page,
      close: async () => {
        await browserInstance.close();
      },
    };
  },
  loadScript: async (scriptPath: string): Promise<RuntimeScript> => {
    const mod = await import(pathToFileURL(scriptPath).href);
    if (typeof mod.default !== 'function') {
      throw new Error(`runtime script ${scriptPath} must export a default async function`);
    }
    return mod.default as RuntimeScript;
  },
};

export const runtimeExecutor: GraderExecutor = makeRuntimeExecutor(realDeps);
