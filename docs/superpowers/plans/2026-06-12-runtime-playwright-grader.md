# Runtime (Playwright) Grader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained `runtime` grader kind that spins up the agent's built app, drives a real Auth0 login via Playwright against a dedicated test tenant, and asserts logged-in state — wired to `react_quickstart` only.

**Architecture:** A new `runtime` grader kind (tagged L4) executes as the final grader, after all static/event graders. Its executor copies the workspace, swaps the prompt's fake Auth0 values for real test-tenant values (from env), runs the eval's declared `serve_command`, waits for the declared port, launches headless Chromium, invokes the eval's per-eval `playwright.ts` script with `{ page, baseURL, testUser }`, maps the result to a `GraderResult`, and always tears down. Browser/script dependencies are injectable so unit tests never launch a real browser. Runs inside the Docker sandbox (Chromium added to the image) or on the host with `--dangerously-skip-sandbox`.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, Playwright (`playwright` package), Node `child_process`/`net` for server startup, Docker.

**Spec:** `docs/superpowers/specs/2026-06-12-runtime-playwright-grader-design.md`

---

## File Structure

**Create:**
- `packages/eval-core/src/graders/executors/runtime.ts` — the runtime executor + injectable browser/script deps.
- `packages/eval-core/src/graders/runtime/prepare-workspace.ts` — copy workspace + apply credential swap.
- `packages/eval-core/src/graders/runtime/resolve-config.ts` — parse `runtime_swap`, resolve env, build runtime config.
- `packages/eval-core/src/graders/runtime/serve.ts` — start dev server, wait for port, teardown handle.
- `packages/eval-core/tests/graders/runtime/prepare-workspace.test.ts`
- `packages/eval-core/tests/graders/runtime/resolve-config.test.ts`
- `packages/eval-core/tests/graders/runtime/serve.test.ts`
- `packages/eval-core/tests/graders/runtime/executor.test.ts`
- `apps/auth0-evals/src/evals/quickstarts/react/playwright.ts` — the per-eval Playwright script.
- `docs/RUNTIME_GRADING.md` — tenant setup, env vars, CI requirement.

**Modify:**
- `packages/eval-graders/src/types.ts` — add `scriptPath?` to `GraderDef`; add `RuntimeContext`/`RuntimeOutcome`/`RuntimeTestUser` types.
- `packages/eval-graders/src/primitives.ts` — add `runtime()` primitive.
- `packages/eval-graders/src/index.ts` — export `runtime` + the new types.
- `packages/eval-graders/package.json` — add `playwright` devDependency (for `Page` type).
- `packages/eval-core/src/graders/executors/types.ts` — add `runtime?` field to `GraderContext`.
- `packages/eval-core/src/graders/engine.ts` — register `runtimeExecutor`; build `runtime` context in `runGraders`.
- `packages/eval-core/src/types/eval.ts` — add `serveCommand?`, `servePort?`, `runtimeSwap?` to `EvalDefinition`.
- `packages/eval-core/src/loader.ts` — parse the three new frontmatter fields.
- `packages/eval-core/package.json` — add `playwright` dependency.
- `apps/auth0-evals/src/evals/quickstarts/react/PROMPT.md` — add frontmatter fields + test-id task text.
- `apps/auth0-evals/src/evals/quickstarts/react/graders.ts` — add `runtime()` grader + static test-id graders.
- `apps/auth0-evals/package.json` — add `playwright` dependency (Page type for authoring).
- `docker/Dockerfile` — install Playwright Chromium + system libs.
- `packages/eval/src/sandbox/docker.ts` — forward `RUNTIME_*` env vars into the container.
- `AGENTS.md` — grader primitives table, frontmatter fields, runtime grader note.
- `docs/ADDING_EVALS.md` — `serve_command`/`serve_port`/`runtime_swap` + `playwright.ts`.

---

## Task 1: Add runtime types + `scriptPath` field to `@a0/eval-graders`

**Files:**
- Modify: `packages/eval-graders/src/types.ts`
- Modify: `packages/eval-graders/package.json`

- [ ] **Step 1: Add `playwright` devDependency for the `Page` type**

In `packages/eval-graders/package.json`, add to `devDependencies` (keep alphabetical):

```json
    "playwright": "^1.50.0",
```

- [ ] **Step 2: Add the new types and `scriptPath` field**

In `packages/eval-graders/src/types.ts`, add this import at the top (after the file's opening comment):

```typescript
import type { Page } from 'playwright';
```

Add `scriptPath?: string;` to the `GraderDef` interface (after the `predicate?` line):

```typescript
export interface GraderDef {
  kind: string;
  name: string;
  needle?: string;
  pattern?: string;
  question?: string;
  level?: GraderLevel;
  caseSensitive?: boolean;
  predicate?: (toolCalls: EventToolCall[]) => boolean;
  /** Path to a per-eval Playwright script (runtime graders only). Relative to the eval dir. */
  scriptPath?: string;
}
```

Append these new types at the end of the file:

```typescript
// ── Runtime (Playwright) grader types ────────────────────────────────────────

/** Test-user credentials + expected display name, injected into the runtime script. */
export interface RuntimeTestUser {
  email: string;
  password: string;
  /** The display name the logged-in UI is expected to show. */
  expectedName: string;
}

/** Context passed to a per-eval Playwright script's default export. */
export interface RuntimeContext {
  /** A Playwright Page already created on a fresh browser context. */
  page: Page;
  /** The base URL the served app is reachable at (e.g. http://localhost:5173). */
  baseURL: string;
  /** Real test-tenant user credentials for the login flow. */
  testUser: RuntimeTestUser;
}

/** Outcome a per-eval Playwright script returns. */
export interface RuntimeOutcome {
  passed: boolean;
  /** Human-readable detail shown in the grader result. */
  detail: string;
}

/** The shape of a per-eval Playwright script's default export. */
export type RuntimeScript = (ctx: RuntimeContext) => Promise<RuntimeOutcome>;
```

- [ ] **Step 3: Build to verify types compile**

Run: `npm run build --workspace @a0/eval-graders`
Expected: PASS (no TS errors). If `playwright` types aren't found, run `npm install` at the repo root first.

- [ ] **Step 4: Commit**

```bash
git add packages/eval-graders/src/types.ts packages/eval-graders/package.json package-lock.json
git commit -m "feat(graders): add runtime grader types and scriptPath field"
```

---

## Task 2: Add the `runtime()` primitive

**Files:**
- Modify: `packages/eval-graders/src/primitives.ts`
- Modify: `packages/eval-graders/src/index.ts`
- Test: `packages/eval-graders/tests/primitives.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/eval-graders/tests/primitives.test.ts`:

```typescript
import { runtime } from '../src/primitives.js';

describe('runtime', () => {
  it('creates a GraderDef with kind "runtime"', () => {
    const def = runtime('./playwright.ts', 'logs in via Auth0');
    expect(def.kind).toBe('runtime');
    expect(def.scriptPath).toBe('./playwright.ts');
  });

  it('uses the description as the name', () => {
    const def = runtime('./playwright.ts', 'logs in via Auth0');
    expect(def.name).toBe('logs in via Auth0');
  });

  it('is always tagged L4', () => {
    const def = runtime('./playwright.ts', 'logs in via Auth0');
    expect(def.level).toBe(GraderLevel.L4);
  });
});
```

(`describe`/`it`/`expect` and `GraderLevel` are already imported at the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @a0/eval-graders -- primitives`
Expected: FAIL with `runtime is not a function` / import error.

- [ ] **Step 3: Implement the primitive**

Append to `packages/eval-graders/src/primitives.ts`:

```typescript
// ── Runtime (Playwright) grader ───────────────────────────────────────────────

/**
 * Asserts that the agent's built app passes a runtime browser check.
 *
 * The executor copies the workspace, swaps fake Auth0 values for real ones,
 * serves the app, launches headless Chromium, and runs the per-eval Playwright
 * script at `scriptPath` (its default export). Always tagged L4 (runs in agent
 * configurations only).
 *
 * @param scriptPath - Path to the Playwright script, relative to the eval directory.
 * @param description - Human-readable grader name.
 */
export function runtime(scriptPath: string, description: string): GraderDef {
  return {
    kind: 'runtime',
    name: description,
    scriptPath,
    level: GraderLevel.L4,
  };
}
```

- [ ] **Step 4: Export it**

In `packages/eval-graders/src/index.ts`, add `runtime` to the primitives export block and export the new types:

```typescript
// Types
export { GraderLevel } from './types.js';
export type {
  GraderResult,
  GraderDef,
  GraderOptions,
  EventToolCall,
  EventGraderLevel,
  RuntimeContext,
  RuntimeOutcome,
  RuntimeTestUser,
  RuntimeScript,
} from './types.js';

// Grader factory functions
export {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  ranCommand,
  ranCommandOneOf,
  wroteFile,
  runtime,
} from './primitives.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @a0/eval-graders -- primitives`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/eval-graders/src/primitives.ts packages/eval-graders/src/index.ts packages/eval-graders/tests/primitives.test.ts
git commit -m "feat(graders): add runtime() primitive"
```

---

## Task 3: Extend `EvalDefinition` + loader with the three frontmatter fields

**Files:**
- Modify: `packages/eval-core/src/types/eval.ts`
- Modify: `packages/eval-core/src/loader.ts:67-84`
- Test: `packages/eval-core/tests/loader.test.ts` (create if absent)

- [ ] **Step 1: Add the fields to `EvalDefinition`**

In `packages/eval-core/src/types/eval.ts`, add to the interface (after `setupCommand?`):

```typescript
export interface EvalDefinition {
  id: string;
  name: string;
  category: string;
  path: string;
  baselineSystemPrompt: string;
  userPrompt: string;
  graders: GraderDef[];
  scaffold: Record<string, string>;
  setupCommand?: string;
  /** Command that starts the built app for runtime grading (e.g. "npm run dev"). */
  serveCommand?: string;
  /** Port the served app listens on (e.g. 5173). */
  servePort?: number;
  /** Raw `runtime_swap` frontmatter string: "fake=$ENV, fake2=$ENV2". */
  runtimeSwap?: string;
  skills: string[];
  metadata: Record<string, string>;
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/eval-core/tests/loader.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEval } from '../src/loader.js';

describe('loadEval — runtime frontmatter', () => {
  let root: string;
  let evalDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'loader-test-'));
    evalDir = join(root, 'src/evals/demo');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(
      join(evalDir, 'PROMPT.md'),
      [
        '---',
        'id: demo',
        'name: Demo',
        'serve_command: npm run dev',
        'serve_port: 5173',
        'runtime_swap: fake.auth0.com=$RUNTIME_AUTH0_DOMAIN',
        '---',
        '',
        '## Task',
        'Do the thing.',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(evalDir, 'graders.ts'),
      'export function defineGraders() { return []; }\n',
    );
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('parses serve_command, serve_port, and runtime_swap', async () => {
    const def = await loadEval(
      { id: 'demo', name: 'Demo', category: 'demo', path: 'src/evals/demo' },
      root,
    );
    expect(def.serveCommand).toBe('npm run dev');
    expect(def.servePort).toBe(5173);
    expect(def.runtimeSwap).toBe('fake.auth0.com=$RUNTIME_AUTH0_DOMAIN');
  });

  it('leaves fields undefined when frontmatter omits them', async () => {
    writeFileSync(
      join(evalDir, 'PROMPT.md'),
      ['---', 'id: demo', 'name: Demo', '---', '', '## Task', 'x', ''].join('\n'),
    );
    const def = await loadEval(
      { id: 'demo', name: 'Demo', category: 'demo', path: 'src/evals/demo' },
      root,
    );
    expect(def.serveCommand).toBeUndefined();
    expect(def.servePort).toBeUndefined();
    expect(def.runtimeSwap).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --workspace @a0/eval-core -- loader`
Expected: FAIL — `serveCommand` is `undefined` in the first test (loader doesn't parse it yet).

- [ ] **Step 4: Parse the fields in the loader**

In `packages/eval-core/src/loader.ts`, inside `loadEval`, after the `const setupCommand = meta.setup_command || undefined;` line (currently line 65), add:

```typescript
  const serveCommand = meta.serve_command || undefined;
  const servePort = meta.serve_port ? Number(meta.serve_port) : undefined;
  const runtimeSwap = meta.runtime_swap || undefined;
```

Then add the three fields to the returned object (after `setupCommand,`):

```typescript
    setupCommand,
    serveCommand,
    servePort,
    runtimeSwap,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @a0/eval-core -- loader`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add packages/eval-core/src/types/eval.ts packages/eval-core/src/loader.ts packages/eval-core/tests/loader.test.ts
git commit -m "feat(core): parse serve_command, serve_port, runtime_swap frontmatter"
```

---

## Task 4: `resolveRuntimeConfig` — parse swap pairs + resolve env

**Files:**
- Create: `packages/eval-core/src/graders/runtime/resolve-config.ts`
- Test: `packages/eval-core/tests/graders/runtime/resolve-config.test.ts`

This unit turns the raw `runtime_swap` string + `process.env` into the structured `runtime` config (or reports what's missing). Pure function — easy to test.

- [ ] **Step 1: Write the failing test**

Create `packages/eval-core/tests/graders/runtime/resolve-config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveRuntimeConfig } from '../../../src/graders/runtime/resolve-config.js';

const fullEnv = {
  RUNTIME_AUTH0_DOMAIN: 'real.us.auth0.com',
  RUNTIME_TEST_USER_EMAIL: 'tester@example.com',
  RUNTIME_TEST_USER_PASSWORD: 'pw',
  RUNTIME_TEST_USER_NAME: 'Test User',
};

describe('resolveRuntimeConfig', () => {
  it('parses swap pairs and resolves env vars', () => {
    const res = resolveRuntimeConfig(
      { serveCommand: 'npm run dev', servePort: 5173, runtimeSwap: 'fake.auth0.com=$RUNTIME_AUTH0_DOMAIN' },
      fullEnv,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.swap).toEqual([{ from: 'fake.auth0.com', to: 'real.us.auth0.com' }]);
    expect(res.config.serveCommand).toBe('npm run dev');
    expect(res.config.servePort).toBe(5173);
    expect(res.config.testUser).toEqual({
      email: 'tester@example.com',
      password: 'pw',
      expectedName: 'Test User',
    });
  });

  it('reports missing test-user env vars', () => {
    const res = resolveRuntimeConfig(
      { serveCommand: 'npm run dev', servePort: 5173, runtimeSwap: 'fake.auth0.com=$RUNTIME_AUTH0_DOMAIN' },
      { RUNTIME_AUTH0_DOMAIN: 'real.us.auth0.com' },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missing).toContain('RUNTIME_TEST_USER_EMAIL');
    expect(res.missing).toContain('RUNTIME_TEST_USER_PASSWORD');
    expect(res.missing).toContain('RUNTIME_TEST_USER_NAME');
  });

  it('reports a swap env var that is not set', () => {
    const res = resolveRuntimeConfig(
      { serveCommand: 'npm run dev', servePort: 5173, runtimeSwap: 'fake.auth0.com=$RUNTIME_AUTH0_DOMAIN' },
      { RUNTIME_TEST_USER_EMAIL: 'a', RUNTIME_TEST_USER_PASSWORD: 'b', RUNTIME_TEST_USER_NAME: 'c' },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missing).toContain('RUNTIME_AUTH0_DOMAIN');
  });

  it('reports missing serve_command / serve_port', () => {
    const res = resolveRuntimeConfig({ runtimeSwap: 'fake=$RUNTIME_AUTH0_DOMAIN' }, fullEnv);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missing).toContain('serve_command');
    expect(res.missing).toContain('serve_port');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @a0/eval-core -- resolve-config`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resolveRuntimeConfig`**

Create `packages/eval-core/src/graders/runtime/resolve-config.ts`:

```typescript
/**
 * Resolves the raw runtime frontmatter (serve_command, serve_port, runtime_swap)
 * plus process env into a structured runtime config — or reports what is missing.
 *
 * Pure function: takes an explicit env map so it is trivially testable.
 */

import type { RuntimeTestUser } from '@a0/eval-graders';

export interface RuntimeConfig {
  serveCommand: string;
  servePort: number;
  swap: Array<{ from: string; to: string }>;
  testUser: RuntimeTestUser;
}

export interface RuntimeFrontmatter {
  serveCommand?: string;
  servePort?: number;
  runtimeSwap?: string;
}

export type ResolveResult =
  | { ok: true; config: RuntimeConfig }
  | { ok: false; missing: string[] };

const TEST_USER_VARS = {
  email: 'RUNTIME_TEST_USER_EMAIL',
  password: 'RUNTIME_TEST_USER_PASSWORD',
  expectedName: 'RUNTIME_TEST_USER_NAME',
} as const;

/**
 * Parses a `runtime_swap` string ("fake=$VAR, fake2=$VAR2") into from/to pairs,
 * resolving each `$VAR` against env. Returns the resolved pairs plus the names
 * of any env vars that were referenced but not set.
 */
function parseSwap(
  raw: string | undefined,
  env: Record<string, string | undefined>,
): { pairs: Array<{ from: string; to: string }>; missing: string[] } {
  const pairs: Array<{ from: string; to: string }> = [];
  const missing: string[] = [];
  if (!raw) return { pairs, missing };

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const from = trimmed.slice(0, eq).trim();
    const rhs = trimmed.slice(eq + 1).trim();
    const varName = rhs.startsWith('$') ? rhs.slice(1) : rhs;
    const value = env[varName];
    if (value === undefined || value === '') {
      missing.push(varName);
      continue;
    }
    pairs.push({ from, to: value });
  }
  return { pairs, missing };
}

export function resolveRuntimeConfig(
  fm: RuntimeFrontmatter,
  env: Record<string, string | undefined>,
): ResolveResult {
  const missing: string[] = [];

  if (!fm.serveCommand) missing.push('serve_command');
  if (!fm.servePort) missing.push('serve_port');

  const { pairs, missing: swapMissing } = parseSwap(fm.runtimeSwap, env);
  missing.push(...swapMissing);

  const testUser: RuntimeTestUser = { email: '', password: '', expectedName: '' };
  for (const [key, varName] of Object.entries(TEST_USER_VARS)) {
    const value = env[varName];
    if (value === undefined || value === '') {
      missing.push(varName);
    } else {
      testUser[key as keyof RuntimeTestUser] = value;
    }
  }

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      serveCommand: fm.serveCommand!,
      servePort: fm.servePort!,
      swap: pairs,
      testUser,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @a0/eval-core -- resolve-config`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add packages/eval-core/src/graders/runtime/resolve-config.ts packages/eval-core/tests/graders/runtime/resolve-config.test.ts
git commit -m "feat(core): resolve runtime config from frontmatter + env"
```

---

## Task 5: `prepareRuntimeWorkspace` — copy workspace + apply swap

**Files:**
- Create: `packages/eval-core/src/graders/runtime/prepare-workspace.ts`
- Test: `packages/eval-core/tests/graders/runtime/prepare-workspace.test.ts`

Copies the workspace to a sibling temp dir and applies the fake→real string swap across text files. The original is never touched.

- [ ] **Step 1: Write the failing test**

Create `packages/eval-core/tests/graders/runtime/prepare-workspace.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRuntimeWorkspace } from '../../../src/graders/runtime/prepare-workspace.js';

describe('prepareRuntimeWorkspace', () => {
  const created: string[] = [];

  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeWorkspace(): string {
    const ws = mkdtempSync(join(tmpdir(), 'rt-ws-'));
    created.push(ws);
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src/App.jsx'), 'domain="fake.auth0.com" clientId="fake_client"');
    return ws;
  }

  it('copies the workspace and swaps fake values for real ones', () => {
    const ws = makeWorkspace();
    const { copyPath, cleanup } = prepareRuntimeWorkspace(ws, [
      { from: 'fake.auth0.com', to: 'real.us.auth0.com' },
      { from: 'fake_client', to: 'REAL_CLIENT' },
    ]);
    created.push(copyPath);

    const copied = readFileSync(join(copyPath, 'src/App.jsx'), 'utf-8');
    expect(copied).toContain('real.us.auth0.com');
    expect(copied).toContain('REAL_CLIENT');
    expect(copied).not.toContain('fake.auth0.com');

    cleanup();
    expect(existsSync(copyPath)).toBe(false);
  });

  it('leaves the original workspace untouched', () => {
    const ws = makeWorkspace();
    const { copyPath, cleanup } = prepareRuntimeWorkspace(ws, [
      { from: 'fake.auth0.com', to: 'real.us.auth0.com' },
    ]);
    created.push(copyPath);

    const original = readFileSync(join(ws, 'src/App.jsx'), 'utf-8');
    expect(original).toContain('fake.auth0.com');
    cleanup();
  });

  it('skips node_modules when copying', () => {
    const ws = makeWorkspace();
    mkdirSync(join(ws, 'node_modules/foo'), { recursive: true });
    writeFileSync(join(ws, 'node_modules/foo/index.js'), 'noise');
    const { copyPath, cleanup } = prepareRuntimeWorkspace(ws, []);
    created.push(copyPath);
    expect(existsSync(join(copyPath, 'node_modules'))).toBe(false);
    cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @a0/eval-core -- prepare-workspace`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `prepareRuntimeWorkspace`**

Create `packages/eval-core/src/graders/runtime/prepare-workspace.ts`:

```typescript
/**
 * Copies a workspace into a throwaway sibling directory and applies the
 * fake→real credential swap across text files. The original workspace (which
 * static graders saw and which gets reported) is never mutated.
 *
 * node_modules is skipped — the runtime grader reinstalls/serves from the copy,
 * and copying node_modules would be slow and large. Dotfiles like .env ARE
 * copied so the agent's env wiring carries over.
 */

import { cpSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

export interface PreparedRuntimeWorkspace {
  /** Absolute path to the throwaway copy. */
  copyPath: string;
  /** Removes the copy. Safe to call multiple times. */
  cleanup: () => void;
}

// Binary/build dirs that must not be swapped or copied.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.nuxt', '.output', '.angular']);

// Only swap inside text files. Skip anything that looks binary by extension.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|jar|class|so|dylib|node)$/i;

function applySwapInDir(dir: string, swap: Array<{ from: string; to: string }>): void {
  if (swap.length === 0) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      applySwapInDir(join(dir, entry.name), swap);
    } else if (entry.isFile()) {
      if (BINARY_EXT.test(entry.name)) continue;
      const full = join(dir, entry.name);
      let content: string;
      try {
        content = readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      let next = content;
      for (const { from, to } of swap) {
        next = next.split(from).join(to);
      }
      if (next !== content) writeFileSync(full, next, 'utf-8');
    }
  }
}

export function prepareRuntimeWorkspace(
  workspace: string,
  swap: Array<{ from: string; to: string }>,
): PreparedRuntimeWorkspace {
  const copyPath = mkdtempSync(join(dirname(workspace), basename(workspace) + '-runtime-'));

  cpSync(workspace, copyPath, {
    recursive: true,
    filter: (src) => {
      try {
        if (statSync(src).isDirectory() && SKIP_DIRS.has(basename(src))) return false;
      } catch {
        return false;
      }
      return true;
    },
  });

  applySwapInDir(copyPath, swap);

  return {
    copyPath,
    cleanup: () => rmSync(copyPath, { recursive: true, force: true }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @a0/eval-core -- prepare-workspace`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add packages/eval-core/src/graders/runtime/prepare-workspace.ts packages/eval-core/tests/graders/runtime/prepare-workspace.test.ts
git commit -m "feat(core): prepareRuntimeWorkspace copies workspace and swaps creds"
```

---

## Task 6: `startServer` — spawn dev server + wait for port

**Files:**
- Create: `packages/eval-core/src/graders/runtime/serve.ts`
- Test: `packages/eval-core/tests/graders/runtime/serve.test.ts`

Starts the declared serve command in the copy dir, polls the port until it accepts TCP (or times out), and returns a handle whose `.stop()` kills the process tree.

- [ ] **Step 1: Write the failing test**

Create `packages/eval-core/tests/graders/runtime/serve.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../../src/graders/runtime/serve.js';

describe('startServer', () => {
  const dirs: string[] = [];
  let handle: { stop: () => Promise<void> } | undefined;

  afterEach(async () => {
    if (handle) await handle.stop();
    handle = undefined;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'serve-test-'));
    dirs.push(d);
    return d;
  }

  it('resolves once the port is accepting connections', async () => {
    const dir = tmp();
    const port = 47213;
    // A tiny node http server bound to the port.
    const cmd = `node -e "require('http').createServer((_, r) => r.end('ok')).listen(${port})"`;
    handle = await startServer(dir, cmd, port, { timeoutMs: 10_000, pollMs: 100 });
    expect(handle).toBeDefined();
  });

  it('rejects when the port never opens within the timeout', async () => {
    const dir = tmp();
    const port = 47214;
    // A command that exits immediately and never binds the port.
    const cmd = `node -e "process.exit(0)"`;
    await expect(startServer(dir, cmd, port, { timeoutMs: 1500, pollMs: 100 })).rejects.toThrow(
      /never opened port/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @a0/eval-core -- serve`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `startServer`**

Create `packages/eval-core/src/graders/runtime/serve.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @a0/eval-core -- serve`
Expected: PASS (both tests). The first test starts a real node http server; the second verifies the timeout path.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-core/src/graders/runtime/serve.ts packages/eval-core/tests/graders/runtime/serve.test.ts
git commit -m "feat(core): startServer waits for dev server port"
```

---

## Task 7: The `runtime` executor (with injectable browser + script deps)

**Files:**
- Create: `packages/eval-core/src/graders/executors/runtime.ts`
- Modify: `packages/eval-core/src/graders/executors/types.ts`
- Modify: `packages/eval-core/package.json`
- Test: `packages/eval-core/tests/graders/runtime/executor.test.ts`

The executor orchestrates the session. To keep unit tests from launching a real browser, it accepts two injectable dependencies (a browser launcher and a script loader) that default to real implementations. Tests inject fakes.

- [ ] **Step 1: Add `playwright` dependency to eval-core**

In `packages/eval-core/package.json`, add to `dependencies` (after `@a0/eval-graders`):

```json
    "playwright": "^1.50.0",
```

- [ ] **Step 2: Extend `GraderContext` with the runtime field**

In `packages/eval-core/src/graders/executors/types.ts`, add the import and the field:

```typescript
import type { GraderDef, GraderResult, EventToolCall, RuntimeTestUser } from '@a0/eval-graders';
```

Add to the `GraderContext` interface (after `toolCalls?`):

```typescript
  /** Runtime grading config — present only when an eval declares runtime grading. */
  runtime?: {
    serveCommand: string;
    servePort: number;
    swap: Array<{ from: string; to: string }>;
    testUser: RuntimeTestUser;
    /** Absolute path to the eval directory (to resolve scriptPath). */
    evalDir: string;
  };
```

- [ ] **Step 3: Write the failing test**

Create `packages/eval-core/tests/graders/runtime/executor.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraderLevel } from '@a0/eval-graders';
import type { GraderDef } from '@a0/eval-graders';
import { makeRuntimeExecutor } from '../../../src/graders/executors/runtime.js';
import type { GraderContext } from '../../../src/graders/executors/types.js';

describe('runtime executor', () => {
  const created: string[] = [];
  afterEach(() => {
    for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function workspace(): string {
    const ws = mkdtempSync(join(tmpdir(), 'rt-exec-'));
    created.push(ws);
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src/App.jsx'), 'domain="fake.auth0.com"');
    return ws;
  }

  const def: GraderDef = {
    kind: 'runtime',
    name: 'logs in',
    scriptPath: './playwright.ts',
    level: GraderLevel.L4,
  };

  function baseContext(ws: string): GraderContext {
    return {
      workspace: ws,
      files: {},
      combinedText: '',
      combinedLower: '',
      runtime: {
        serveCommand: 'noop',
        servePort: 5173,
        swap: [{ from: 'fake.auth0.com', to: 'real.us.auth0.com' }],
        testUser: { email: 'a@b.com', password: 'pw', expectedName: 'Tester' },
        evalDir: ws,
      },
    };
  }

  it('fails when runtime context is absent', async () => {
    const ws = workspace();
    const exec = makeRuntimeExecutor({
      launchBrowser: async () => {
        throw new Error('should not launch');
      },
      loadScript: async () => async () => ({ passed: true, detail: 'x' }),
      serve: async () => ({ stop: async () => {} }),
    });
    const ctx = baseContext(ws);
    delete ctx.runtime;
    const res = await exec.execute(def, ctx);
    expect(res.passed).toBe(false);
    expect(res.detail).toMatch(/runtime grading/i);
    expect(res.level).toBe(GraderLevel.L4);
  });

  it('passes when the injected script returns passed:true', async () => {
    const ws = workspace();
    let served = false;
    let stopped = false;
    let browserClosed = false;
    const exec = makeRuntimeExecutor({
      serve: async () => {
        served = true;
        return { stop: async () => { stopped = true; } };
      },
      launchBrowser: async () => ({
        page: {} as never,
        close: async () => { browserClosed = true; },
      }),
      loadScript: async () => async ({ baseURL, testUser }) => ({
        passed: true,
        detail: `ok ${baseURL} ${testUser.expectedName}`,
      }),
    });
    const res = await exec.execute(def, baseContext(ws));
    expect(res.passed).toBe(true);
    expect(res.detail).toContain('http://localhost:5173');
    expect(served).toBe(true);
    expect(stopped).toBe(true);
    expect(browserClosed).toBe(true);
  });

  it('fails (no throw) when the script throws, and still tears down', async () => {
    const ws = workspace();
    let stopped = false;
    const exec = makeRuntimeExecutor({
      serve: async () => ({ stop: async () => { stopped = true; } }),
      launchBrowser: async () => ({ page: {} as never, close: async () => {} }),
      loadScript: async () => async () => {
        throw new Error('login failed: selector not found');
      },
    });
    const res = await exec.execute(def, baseContext(ws));
    expect(res.passed).toBe(false);
    expect(res.detail).toContain('login failed');
    expect(stopped).toBe(true);
  });

  it('fails when serve never opens the port', async () => {
    const ws = workspace();
    const exec = makeRuntimeExecutor({
      serve: async () => {
        throw new Error('serve_command never opened port 5173 within 1000ms');
      },
      launchBrowser: async () => {
        throw new Error('should not launch');
      },
      loadScript: async () => async () => ({ passed: true, detail: 'x' }),
    });
    const res = await exec.execute(def, baseContext(ws));
    expect(res.passed).toBe(false);
    expect(res.detail).toContain('never opened port');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test --workspace @a0/eval-core -- executor`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the executor with injectable deps**

Create `packages/eval-core/src/graders/executors/runtime.ts`:

```typescript
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test --workspace @a0/eval-core -- executor`
Expected: PASS (all four tests).

- [ ] **Step 7: Commit**

```bash
git add packages/eval-core/src/graders/executors/runtime.ts packages/eval-core/src/graders/executors/types.ts packages/eval-core/package.json package-lock.json packages/eval-core/tests/graders/runtime/executor.test.ts
git commit -m "feat(core): runtime grader executor with injectable browser deps"
```

---

## Task 8: Register the executor + build runtime context in `runGraders`

**Files:**
- Modify: `packages/eval-core/src/graders/engine.ts`
- Test: `packages/eval-core/tests/graders/engine.test.ts`

`runGraders` must register the runtime executor and, when any active grader is `kind: 'runtime'`, resolve the runtime config from the eval's frontmatter + env and attach it to the context. Since `runGraders` currently takes `workspace` + `apiKey` but not the eval definition, we pass the runtime frontmatter through a new optional parameter.

- [ ] **Step 1: Write the failing test**

The existing `engine.test.ts` already imports `describe, it, expect, vi, afterEach, beforeAll` from `vitest`, `makeTmpDir` from `../tmp.js`, and `GraderLevel` / `type GraderResult` / `type EventToolCall` from `@a0/eval-graders` (verify by reading lines 1-20 first). **Do NOT re-import those** — duplicate imports are a compile error. Add only what is missing: `runGraders` from `../../src/graders/engine.js` (check whether it's already imported) and `type GraderDef` from `@a0/eval-graders`. 

Note `makeTmpDir()` returns a *factory* and registers its own `afterEach` for cleanup, so it must be called at `describe` scope (not inside `it`), then invoked to get a directory. Append this `describe` block at the end of the file:

```typescript
describe('runGraders — runtime grader', () => {
  const tmp = makeTmpDir('engine-rt-');

  it('fails a runtime grader when RUNTIME_* env vars are missing', async () => {
    const ws = tmp();
    const def: GraderDef = {
      kind: 'runtime',
      name: 'logs in',
      scriptPath: './playwright.ts',
      level: GraderLevel.L4,
    };
    const results = await runGraders(
      [def],
      ws,
      'key',
      undefined,
      new Set([GraderLevel.L4]),
      true,
      [],
      {
        frontmatter: { serveCommand: 'npm run dev', servePort: 5173, runtimeSwap: 'fake=$RUNTIME_AUTH0_DOMAIN' },
        evalDir: ws,
        env: {}, // nothing set → must fail
      },
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.detail).toMatch(/runtime grading|RUNTIME_/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @a0/eval-core -- engine`
Expected: FAIL — `runGraders` does not accept the 8th argument / runtime kind unknown.

- [ ] **Step 3: Register the executor**

In `packages/eval-core/src/graders/engine.ts`, add the import (after the `eventExecutor` import on line 23):

```typescript
import { runtimeExecutor } from './executors/runtime.js';
```

And register it (after `registerExecutor(eventExecutor);` on line 35):

```typescript
registerExecutor(runtimeExecutor);
```

- [ ] **Step 4: Add the runtime options parameter + context wiring**

Add the import near the top of `engine.ts`:

```typescript
import { resolveRuntimeConfig } from './runtime/resolve-config.js';
```

Change the `runGraders` signature to accept an 8th optional argument and build the runtime context. Replace the signature and the context-construction block:

```typescript
export interface RuntimeGradingOptions {
  frontmatter: { serveCommand?: string; servePort?: number; runtimeSwap?: string };
  evalDir: string;
  /** Defaults to process.env. Injectable for tests. */
  env?: Record<string, string | undefined>;
}

export async function runGraders(
  graderDefs: GraderDef[],
  workspace: string,
  apiKey: string,
  judgeModel?: string,
  allowedLevels?: Set<GraderLevel>,
  enforceMaxChars: boolean = true,
  toolCalls?: EventToolCall[],
  runtimeOptions?: RuntimeGradingOptions,
): Promise<GraderResult[]> {
  const config = getFrameworkConfig();
  const resolvedJudgeModel = judgeModel ?? config.judge.model ?? '';
  const judgeMaxCodeChars = config.judge.maxCodeChars ?? 32_768;
  const judgeMaxTokens = config.judge.maxTokens ?? 1024;
  const judgeBaseUrl = config.proxy.baseUrl;
  const judgeModelMap = getModelIdMap();
  const active = allowedLevels
    ? graderDefs.filter((g) => g.level === undefined || allowedLevels.has(g.level))
    : graderDefs;

  const hasTextGraders = active.some((g) => g.kind !== 'event' && g.kind !== 'runtime');
  const files = hasTextGraders ? collectFiles(workspace) : {};
  const combinedText = hasTextGraders ? combined(files) : '';
  const combinedLower = hasTextGraders ? combinedText.toLowerCase() : '';

  // Build runtime config only when a runtime grader is active and options were provided.
  let runtime: GraderContextRuntime | undefined;
  const hasRuntimeGrader = active.some((g) => g.kind === 'runtime');
  if (hasRuntimeGrader && runtimeOptions) {
    const resolved = resolveRuntimeConfig(runtimeOptions.frontmatter, runtimeOptions.env ?? process.env);
    if (resolved.ok) {
      runtime = { ...resolved.config, evalDir: runtimeOptions.evalDir };
    }
    // When resolution fails, leave runtime undefined — the executor returns a
    // failed result naming the missing prerequisites.
  }

  const context = {
    workspace,
    files,
    combinedText,
    combinedLower,
    apiKey,
    judge: {
      model: resolvedJudgeModel,
      baseUrl: judgeBaseUrl,
      maxTokens: judgeMaxTokens,
      maxCodeChars: judgeMaxCodeChars,
      modelMap: judgeModelMap,
      enforceMaxChars,
    },
    toolCalls,
    runtime,
  };
```

Add the `GraderContextRuntime` type import at the top of `engine.ts`:

```typescript
import type { GraderContext } from './executors/types.js';
type GraderContextRuntime = NonNullable<GraderContext['runtime']>;
```

(The rest of `runGraders` — the loop over `active` and the result handling — is unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @a0/eval-core -- engine`
Expected: PASS. Also run the full core suite to catch regressions: `npm test --workspace @a0/eval-core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/eval-core/src/graders/engine.ts packages/eval-core/tests/graders/engine.test.ts
git commit -m "feat(core): wire runtime executor + runtime context into runGraders"
```

---

## Task 9: Pass runtime options from both run paths

**Files:**
- Modify: `packages/eval/src/cli/run.ts:164-176`
- Modify: `packages/eval/src/cli/sandbox-runner.ts:111-123`

Both call sites pass the new `runtimeOptions` (frontmatter + evalDir) so the engine can resolve runtime config. `evalDef.path` is the absolute eval directory (set by the loader).

- [ ] **Step 1: Update the host path in `run.ts`**

In `packages/eval/src/cli/run.ts`, the `runGraders(...)` call inside `runAgentJob` (currently lines 167-175). Add the 8th argument:

```typescript
      graderResults = await runGraders(
        evalDef.graders,
        workspace,
        apiKey,
        undefined,
        agentLevels,
        true,
        record.toolCalls,
        {
          frontmatter: {
            serveCommand: evalDef.serveCommand,
            servePort: evalDef.servePort,
            runtimeSwap: evalDef.runtimeSwap,
          },
          evalDir: evalDef.path,
        },
      );
```

- [ ] **Step 2: Update the sandbox path in `sandbox-runner.ts`**

In `packages/eval/src/cli/sandbox-runner.ts`, the `runGraders(...)` call (currently lines 114-122). Add the 8th argument identically:

```typescript
      graderResults = await runGraders(
        evalDef.graders,
        workspace,
        apiKey,
        undefined,
        agentLevels,
        true,
        record.toolCalls,
        {
          frontmatter: {
            serveCommand: evalDef.serveCommand,
            servePort: evalDef.servePort,
            runtimeSwap: evalDef.runtimeSwap,
          },
          evalDir: evalDef.path,
        },
      );
```

- [ ] **Step 3: Build to verify both compile**

Run: `npm run build --workspace @a0/eval`
Expected: PASS (no TS errors).

- [ ] **Step 4: Commit**

```bash
git add packages/eval/src/cli/run.ts packages/eval/src/cli/sandbox-runner.ts
git commit -m "feat(eval): pass runtime grading options into runGraders from both paths"
```

---

## Task 10: Forward `RUNTIME_*` env vars into the Docker container

**Files:**
- Modify: `packages/eval/src/sandbox/docker.ts:132-151`
- Test: `packages/eval/tests/` (add a small unit if an env-flag builder is extracted; otherwise verify by inspection — see note)

The sandbox runs grading inside the container, so the `RUNTIME_*` vars must be forwarded like `LLM_API_KEY` is today.

- [ ] **Step 1: Forward the vars**

In `packages/eval/src/sandbox/docker.ts`, after the `ghToken` block (currently lines 149-151), add:

```typescript
  // Forward runtime-grading credentials (test tenant + test user) when present.
  // These let the in-container runtime grader drive a real Auth0 login.
  const RUNTIME_ENV_VARS = [
    'RUNTIME_AUTH0_DOMAIN',
    'RUNTIME_AUTH0_CLIENT_ID',
    'RUNTIME_AUTH0_AUDIENCE',
    'RUNTIME_TEST_USER_EMAIL',
    'RUNTIME_TEST_USER_PASSWORD',
    'RUNTIME_TEST_USER_NAME',
  ];
  for (const name of RUNTIME_ENV_VARS) {
    const value = process.env[name];
    if (value) envFlags.push('-e', `${name}=${value}`);
  }
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build --workspace @a0/eval`
Expected: PASS.

> **Note on testing:** `runJobInDocker` spawns Docker and is integration-level; this plan does not add a unit test that launches Docker. The forwarding is a small, inspectable addition mirroring the existing `ghToken` pattern. If a future refactor extracts an `buildEnvFlags()` pure function, add a unit test there.

- [ ] **Step 3: Commit**

```bash
git add packages/eval/src/sandbox/docker.ts
git commit -m "feat(eval): forward RUNTIME_* env vars into sandbox container"
```

---

## Task 11: Add Playwright Chromium to the Docker image

**Files:**
- Modify: `docker/Dockerfile`

The container has no browser today. Install Playwright's Chromium + system libs in the runtime stage, into a location readable by the dropped `node` user.

- [ ] **Step 1: Install Chromium in the runtime stage**

In `docker/Dockerfile`, after the `apt-get install` block (currently ending line 44), add:

```dockerfile

# ── Playwright Chromium for runtime (browser) grading ─────────────────────────
# PLAYWRIGHT_BROWSERS_PATH points at a world-readable location so the dropped
# 'node' user (UID 1000) can launch the browser. --with-deps pulls the required
# system libraries (libnss3, libatk, etc.) via apt.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN npx --yes playwright@1.50.0 install --with-deps chromium \
    && chmod -R a+rX /opt/playwright-browsers \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: Build the image to verify it succeeds**

Run: `docker build -f docker/Dockerfile -t auth0-evals-sandbox:plan-check .`
Expected: PASS — image builds; the `playwright install` step downloads Chromium. (This is slow and large; expect several minutes and a notably bigger image.)

- [ ] **Step 3: Verify Chromium is launchable as the node user**

Run:
```bash
docker run --rm --user 1000:1000 -e PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers \
  auth0-evals-sandbox:plan-check \
  node -e "const {chromium}=require('/app/node_modules/playwright'); chromium.launch({headless:true}).then(b=>b.close()).then(()=>console.log('OK')).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: prints `OK`.

> If `playwright` is not present at `/app/node_modules/playwright`, ensure Task 7 added it to `eval-core` deps AND the root `npm ci` in the builder stage installed it (it will, since it's a workspace dependency). Rebuild after fixing.

- [ ] **Step 4: Commit**

```bash
git add docker/Dockerfile
git commit -m "feat(docker): install Playwright Chromium for runtime grading"
```

---

## Task 12: Wire `react_quickstart` — frontmatter, test IDs, script, graders

**Files:**
- Modify: `apps/auth0-evals/src/evals/quickstarts/react/PROMPT.md`
- Create: `apps/auth0-evals/src/evals/quickstarts/react/playwright.ts`
- Modify: `apps/auth0-evals/src/evals/quickstarts/react/graders.ts`
- Modify: `apps/auth0-evals/package.json`

- [ ] **Step 1: Add `playwright` dependency to the app (for the `Page` type when authoring)**

In `apps/auth0-evals/package.json`, add to `dependencies` (after `@a0/eval-reporter`):

```json
    "playwright": "^1.50.0",
```

- [ ] **Step 2: Update PROMPT.md frontmatter + task text**

Replace the contents of `apps/auth0-evals/src/evals/quickstarts/react/PROMPT.md` with:

```markdown
---
id: react_quickstart
name: React Quickstart
scaffold: src/evals/scaffolds/react/basic
skills: auth0-react
setup_command: npm install
serve_command: npm run dev
serve_port: 5173
runtime_swap: dev-barkbook.us.auth0.com=$RUNTIME_AUTH0_DOMAIN, barkbook_client_abc123xyz=$RUNTIME_AUTH0_CLIENT_ID, https://api.barkbook.com=$RUNTIME_AUTH0_AUDIENCE
---

## Task
Add Auth0 login to my React app.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com

I also need to call an external API — get an access token and include a function that makes an authenticated request using that token.

For testing, add these attributes to the UI:
- `data-testid="login"` on the login button
- `data-testid="logout"` on the logout button
- `data-testid="profile"` on the element that displays the logged-in user's name
```

> The dev server must be reachable on port 5173 (the scaffold's Vite default). The test tenant's SPA app must allow `http://localhost:5173` as a callback/logout/web-origin (see `docs/RUNTIME_GRADING.md`).

- [ ] **Step 3: Create the Playwright script**

Create `apps/auth0-evals/src/evals/quickstarts/react/playwright.ts`:

```typescript
import type { RuntimeContext, RuntimeOutcome } from '@a0/eval-graders';

/**
 * Drives a real Auth0 Universal Login against the test tenant and asserts the
 * app reaches a logged-in state showing the user's name.
 *
 * Selectors for Auth0's Universal Login page are intentionally kept here (per
 * eval), not framework-baked, so they are easy to update if the login page
 * markup changes. App selectors use the data-testids mandated by PROMPT.md.
 */
export default async function run({ page, baseURL, testUser }: RuntimeContext): Promise<RuntimeOutcome> {
  await page.goto(baseURL, { waitUntil: 'networkidle' });

  const loginButton = page.getByTestId('login');
  await loginButton.click();

  // Auth0 Universal Login (new identifier-first or classic login form).
  await page.waitForLoadState('networkidle');
  await page.fill('input[name="username"]', testUser.email);

  // Some Universal Login flows split username/password across steps.
  const passwordField = page.locator('input[name="password"]');
  if ((await passwordField.count()) === 0) {
    await page.getByRole('button', { name: /continue|next/i }).first().click();
    await page.waitForSelector('input[name="password"]');
  }
  await page.fill('input[name="password"]', testUser.password);
  await page.getByRole('button', { name: /continue|log ?in|sign ?in/i }).first().click();

  // Back on the app after the redirect callback completes.
  await page.waitForURL(`${baseURL}/**`, { timeout: 30_000 });

  const profile = page.getByTestId('profile');
  await profile.waitFor({ state: 'visible', timeout: 15_000 });
  const text = (await profile.textContent()) ?? '';

  if (!text.includes(testUser.expectedName)) {
    return {
      passed: false,
      detail: `Logged in but profile did not show "${testUser.expectedName}" (saw: "${text.trim()}")`,
    };
  }
  return { passed: true, detail: `Logged in; profile shows "${testUser.expectedName}"` };
}
```

- [ ] **Step 4: Add the runtime grader + static test-id graders to graders.ts**

In `apps/auth0-evals/src/evals/quickstarts/react/graders.ts`, update the import line and add graders. Change line 1:

```typescript
import { contains, notContains, matches, judge, runtime, GraderLevel } from '@a0/eval-graders';
```

Add these to the L1 block (after the existing `matches(String.raw\`user\??\.name\`, ...)` line):

```typescript
    contains('data-testid="login"', 'Login button has data-testid="login"', GraderLevel.L1),
    contains('data-testid="logout"', 'Logout button has data-testid="logout"', GraderLevel.L1),
    contains('data-testid="profile"', 'Profile element has data-testid="profile"', GraderLevel.L1),
```

Add the runtime grader in the L4 block (after the existing `judge(...)` L4 grader, before the L5 block comment):

```typescript
    runtime('./playwright.ts', 'App performs a real Auth0 login and shows the user profile'),
```

- [ ] **Step 5: Build the app to verify it compiles**

Run: `npm run build --workspace auth0-evals`
Expected: PASS. The `playwright.ts` import of `@a0/eval-graders` types resolves; `runtime()` is exported.

- [ ] **Step 6: Commit**

```bash
git add apps/auth0-evals/src/evals/quickstarts/react/PROMPT.md apps/auth0-evals/src/evals/quickstarts/react/playwright.ts apps/auth0-evals/src/evals/quickstarts/react/graders.ts apps/auth0-evals/package.json package-lock.json
git commit -m "feat(evals): add runtime login grading to react_quickstart"
```

---

## Task 13: End-to-end verification against the real test tenant

**Files:** none (verification task)

This is the proof the mechanism works. Requires the test tenant set up per `docs/RUNTIME_GRADING.md` and the `RUNTIME_*` vars in `apps/auth0-evals/.env`.

- [ ] **Step 1: Confirm env vars are present**

Run: `grep -c RUNTIME_AUTH0_DOMAIN apps/auth0-evals/.env`
Expected: `1`. If `0`, set up the tenant and `.env` first (see `docs/RUNTIME_GRADING.md`, Task 14).

- [ ] **Step 2: Run react_quickstart on the host (faster iteration)**

Run:
```bash
npm run build && npm run evals -- --eval react_quickstart --mode agent --agent-type claude-code --dangerously-skip-sandbox --keep-workspace
```
Expected: the run completes; in the JSON output, the grader named "App performs a real Auth0 login and shows the user profile" has `passed: true`. If it failed, read its `detail` (e.g. selector/timeout) and inspect the kept workspace.

- [ ] **Step 3: Run react_quickstart in the Docker sandbox**

Run:
```bash
npm run evals -- --eval react_quickstart --mode agent --agent-type claude-code
```
Expected: same runtime grader passes inside the container (Chromium from Task 11, env forwarded from Task 10).

- [ ] **Step 4: Confirm baseline is unaffected**

Run: `npm run evals -- --eval react_quickstart --mode baseline`
Expected: completes normally; the runtime grader does NOT run (L4 is excluded from baseline), so no browser launch occurs.

> No commit — this task verifies behavior. If steps fail, fix the relevant earlier task and re-verify.

---

## Task 14: Documentation

**Files:**
- Create: `docs/RUNTIME_GRADING.md`
- Modify: `AGENTS.md`
- Modify: `docs/ADDING_EVALS.md`

- [ ] **Step 1: Write `docs/RUNTIME_GRADING.md`**

Create `docs/RUNTIME_GRADING.md`:

```markdown
# Runtime (Playwright) Grading

Some evals verify the agent's output by *running it*: the framework spins up the
built app, drives it with a headless browser (Playwright), performs a real Auth0
login against a dedicated test tenant, and asserts the app reaches a logged-in
state. This is the `runtime` grader kind (tagged L4 — agent configurations only).

## How it works

After the agent finishes and all static/event graders run, the `runtime` grader:

1. Copies the workspace to a throwaway directory and replaces the prompt's fake
   Auth0 values with real test-tenant values (from env). The original workspace
   (with fake values) is what static graders saw and what gets reported.
2. Runs the eval's `serve_command` and waits for `serve_port` to accept connections.
3. Launches headless Chromium and runs the eval's `playwright.ts` script.
4. Tears everything down (server, browser, copy) regardless of outcome.

## Required environment variables

Set these in `apps/auth0-evals/.env` (host) — they are forwarded into the Docker
sandbox automatically:

| Var | Meaning |
|---|---|
| `RUNTIME_AUTH0_DOMAIN` | Test tenant domain (e.g. `your-tenant.us.auth0.com`) |
| `RUNTIME_AUTH0_CLIENT_ID` | Client ID of the test SPA application |
| `RUNTIME_AUTH0_AUDIENCE` | API audience the eval requests a token for |
| `RUNTIME_TEST_USER_EMAIL` | Test user's email |
| `RUNTIME_TEST_USER_PASSWORD` | Test user's password |
| `RUNTIME_TEST_USER_NAME` | Display name the logged-in UI should show |

## One-time test tenant setup

1. Create (or reuse) a dedicated Auth0 **test tenant**. Do not use a production tenant.
2. Create a **Single Page Application**. Note its Client ID.
3. In the app settings, add to **Allowed Callback URLs**, **Allowed Logout URLs**,
   and **Allowed Web Origins**: `http://localhost:5173` (the `serve_port` declared
   by `react_quickstart`). Add other ports here as you add runtime evals on other
   ports.
4. Create an **API** (or reuse one) and note its identifier — that is the audience.
5. Create a **test user** with a known password and set its name to a stable value.
6. Put all six values into `apps/auth0-evals/.env`.

## Operational requirement (important)

The `runtime` grader on `react_quickstart` is **always active** and **hard-fails**
when the `RUNTIME_*` env vars or a browser are missing. Because it is L4, it runs
in **agent** configurations only (baseline is unaffected).

Consequence: **every agent-mode run of `react_quickstart` — including
`/evals-smoke-test` and CI — fails unless the test-tenant creds and a browser are
present.** CI must provide the `RUNTIME_*` values as secrets, and the Docker image
ships Chromium (see `docker/Dockerfile`).

## Adding runtime grading to a new eval

1. Add `serve_command`, `serve_port`, and `runtime_swap` to the eval's PROMPT.md
   frontmatter (see `docs/ADDING_EVALS.md`).
2. Mandate `data-testid`s in the PROMPT.md task text so the script can find UI.
3. Add a `playwright.ts` exporting a default async function
   `({ page, baseURL, testUser }) => Promise<{ passed, detail }>`.
4. Add a `runtime('./playwright.ts', '...')` grader to `graders.ts`.
5. Register the new `serve_port` as an allowed callback URL in the test tenant app.
```

- [ ] **Step 2: Update AGENTS.md grader primitives table**

In `AGENTS.md`, add a row to the grader primitives table (after the `wroteFile` row):

```markdown
| `runtime(scriptPath, description)` | Spins up the app, swaps fake creds for real test-tenant creds, launches headless Chromium, and runs the eval's per-eval Playwright `scriptPath` to drive a real login — always tagged L4. See `docs/RUNTIME_GRADING.md` |
```

- [ ] **Step 3: Update AGENTS.md frontmatter/eval-authoring references**

In `AGENTS.md`, in the "Adding an eval — checklist" section, add a note under step 2:

```markdown
   - For runtime (Playwright) evals, also add `serve_command`, `serve_port`, and `runtime_swap` to frontmatter, ship a `playwright.ts`, and add a `runtime()` grader. See `docs/RUNTIME_GRADING.md`.
```

- [ ] **Step 4: Update docs/ADDING_EVALS.md**

In `docs/ADDING_EVALS.md`, find the frontmatter fields table/section and add entries for the three new fields (match the doc's existing style):

```markdown
| `serve_command` | No | Command that starts the built app for runtime grading (e.g. `npm run dev`). Required only for runtime evals. |
| `serve_port` | No | Port the served app listens on (e.g. `5173`). Required only for runtime evals. |
| `runtime_swap` | No | Comma-separated `fakeValue=$ENV_VAR` pairs. The runtime grader replaces each fake value with the resolved env var in a throwaway workspace copy before launching the app. |
```

And add a short subsection describing the `playwright.ts` file and the `runtime()` grader, pointing to `docs/RUNTIME_GRADING.md` for the full guide.

- [ ] **Step 5: Commit**

```bash
git add docs/RUNTIME_GRADING.md AGENTS.md docs/ADDING_EVALS.md
git commit -m "docs: document runtime (Playwright) grading"
```

---

## Task 15: Full build, lint, format, and test gate

**Files:** none (gate task)

- [ ] **Step 1: Lint and format**

Run: `npm run lint && npm run format`
Expected: no errors; formatting applied.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: PASS across all packages.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS across all packages, including the new runtime tests.

- [ ] **Step 4: Commit any lint/format changes**

```bash
git add -A
git commit -m "chore: lint and format runtime grader changes"
```

(Skip if there is nothing to commit.)

---

## Notes for the implementer

- **ESM discipline:** every relative import needs a `.js` extension, even from `.ts` source. Use `import type` for type-only imports. Use `pathToFileURL(path).href` for dynamic imports of absolute paths (already done in the executor and existing loader).
- **Tools/graders never throw to the caller:** the executor maps every failure to a `GraderResult`. `runGraders` also has a try/catch per grader as a backstop.
- **Secrets:** the throwaway copy holds real creds and is always removed in `finally`. The original workspace keeps fake creds. Do not log resolved `RUNTIME_*` values.
- **Playwright version:** keep the version identical across `eval-graders` (devDep), `eval-core` (dep), `auth0-evals` (dep), and the Dockerfile `playwright install` step. The plan pins `^1.50.0` / `1.50.0` — if you bump one, bump all.
```
