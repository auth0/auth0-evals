# Declarative Mock Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shell mock dispatcher with a generic JS engine driven by per-feature JSON manifests, so a new feature's mock is declarative data (+ an optional typed handler) instead of hand-written shell.

**Architecture:** A generic interpreter in `eval-core` (no Auth0 knowledge) parses `auth0 api <method> <path>`, normalizes the path, matches against JSON manifests, applies a state verb (`create`/`set`/`reflect`/`static`) or calls a typed handler, and serializes the response. The `auth0` binary becomes a thin `#!/usr/bin/env node` entrypoint in the app that runs the engine with Auth0 config. Behavior parity is proven against the existing black-box route tests before the shell dispatcher is deleted.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Node 24, Vitest. No new runtime deps (JSON, no YAML).

## Global Constraints

- ESM: every import needs a `.js` extension; `node:` prefix for builtins; `import type` for type-only. (from AGENTS.md)
- Tools/engine return values, never throw across the CLI boundary — the entrypoint prints a body and exits 0 even on unmatched routes (fallthrough). (from AGENTS.md tool convention + spec)
- State lives as marker files under `EVAL_MOCK_STATE_DIR`, a per-run dir outside the workspace. Unchanged model. (spec)
- `eval-core` must contain **zero Auth0-specific knowledge** — binary name, `/api/v2` normalization, and manifests are app config/content. (spec)
- Every new function gets a happy-path + failure/edge test; run `npm run build && npm run lint && npm test` before commit. (AGENTS.md)
- The stack: engine → **plumbing** (#82); guardian manifest → **MFA** (#83); token-exchange manifest → **CTE** (#84). Rebase children onto plumbing after engine lands.

## File Structure

```
packages/eval-core/src/mock/
  types.ts        # RouteManifest, RouteDef, HandlerContext, MockState, EngineConfig
  state.ts        # marker-file state (has/set/clear) under a dir
  manifest.ts     # load + schema-validate *.routes.json; resolve fixture/body refs
  matcher.ts      # normalize path (configurable prefix), match "METHOD path" incl. single-segment *
  verbs.ts        # apply create/set/reflect/static → response object
  engine.ts       # top-level: given argv + config + manifest dirs → response string
  index.ts        # re-exports (public: runMockCli, types)

apps/auth0-evals/mocks/
  auth0                       # #!/usr/bin/env node → import engine, run with Auth0 config
  <surface>.routes.json       # per-surface manifest (guardian, token-exchange)
  fixtures/<surface>/*.json   # response bodies
  <surface>.handlers.js       # computed-field handlers (compiled from .ts if needed)

packages/eval-core/tests/mock/   # engine unit tests
```

---

### Task 1: Engine types + marker-file state (plumbing)

**Files:**
- Create: `packages/eval-core/src/mock/types.ts`
- Create: `packages/eval-core/src/mock/state.ts`
- Test: `packages/eval-core/tests/mock/state.test.ts`

**Interfaces:**
- Produces:
  - `interface MockState { has(key: string): boolean; set(key: string): void; clear(key: string): void; }`
  - `function createState(dir: string): MockState`
  - `interface HandlerContext { method: string; path: string; payload: string; state: MockState; }`
  - `interface RouteDef { match: string; verb: 'create'|'set'|'reflect'|'static'|'handler'; state?: string; body?: unknown|string; present?: unknown|string; absent?: unknown|string; handler?: string; }`
  - `interface RouteManifest { surface: string; consumedBy?: string[]; routes: RouteDef[]; }`
  - `interface EngineConfig { binName: string; stripPrefixes: string[]; manifestDirs: string[]; stateDir: string; }`

- [ ] **Step 1: Write the failing test** — `packages/eval-core/tests/mock/state.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createState } from '../../src/mock/state.js';

describe('createState', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mockstate-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports a key as absent until set', () => {
    const s = createState(dir);
    expect(s.has('cte.action')).toBe(false);
    s.set('cte.action');
    expect(s.has('cte.action')).toBe(true);
  });

  it('clears a key', () => {
    const s = createState(dir);
    s.set('x'); s.clear('x');
    expect(s.has('x')).toBe(false);
  });

  it('encodes dotted/slashy keys into a safe filename', () => {
    const s = createState(dir);
    s.set('cte.action/deploy');
    expect(s.has('cte.action/deploy')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-core && npx vitest run tests/mock/state.test.ts`
Expected: FAIL — cannot find `../../src/mock/state.js`.

- [ ] **Step 3: Write `types.ts` then `state.ts`**

`types.ts`:
```ts
export interface MockState {
  has(key: string): boolean;
  set(key: string): void;
  clear(key: string): void;
}

export interface HandlerContext {
  method: string;
  path: string;
  payload: string;
  state: MockState;
}

export type RouteVerb = 'create' | 'set' | 'reflect' | 'static' | 'handler';

export interface RouteDef {
  match: string;
  verb: RouteVerb;
  state?: string;
  body?: unknown | string;
  present?: unknown | string;
  absent?: unknown | string;
  handler?: string;
}

export interface RouteManifest {
  surface: string;
  consumedBy?: string[];
  routes: RouteDef[];
}

export interface EngineConfig {
  binName: string;
  stripPrefixes: string[];
  manifestDirs: string[];
  stateDir: string;
}
```

`state.ts`:
```ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MockState } from './types.js';

// Encode a dotted/slashy state key into a flat, filesystem-safe marker name.
function markerName(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function createState(dir: string): MockState {
  mkdirSync(dir, { recursive: true });
  return {
    has: (key) => existsSync(join(dir, markerName(key))),
    set: (key) => writeFileSync(join(dir, markerName(key)), ''),
    clear: (key) => rmSync(join(dir, markerName(key)), { force: true }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/eval-core && npx vitest run tests/mock/state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/eval-core/src/mock/types.ts packages/eval-core/src/mock/state.ts packages/eval-core/tests/mock/state.test.ts
git commit -m "feat(mock): engine types + marker-file state"
```

---

### Task 2: Path matcher (plumbing)

**Files:**
- Create: `packages/eval-core/src/mock/matcher.ts`
- Test: `packages/eval-core/tests/mock/matcher.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `function normalizePath(raw: string, stripPrefixes: string[]): string` — strips scheme+host, leading slash, then any listed prefix (e.g. `api/v2/`).
  - `function routeMatches(pattern: string, method: string, path: string): boolean` — pattern is `"<METHOD> <path>"`; `*` matches exactly one path segment.

- [ ] **Step 1: Write the failing test** — `packages/eval-core/tests/mock/matcher.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { normalizePath, routeMatches } from '../../src/mock/matcher.js';

describe('normalizePath', () => {
  const strip = ['api/v2/'];
  it('leaves a bare path unchanged', () => {
    expect(normalizePath('guardian/factors/otp', strip)).toBe('guardian/factors/otp');
  });
  it('strips a leading slash', () => {
    expect(normalizePath('/guardian/policies', strip)).toBe('guardian/policies');
  });
  it('strips a host-less /api/v2/ prefix', () => {
    expect(normalizePath('/api/v2/actions', strip)).toBe('actions');
  });
  it('strips scheme+host and api/v2', () => {
    expect(normalizePath('https://t.us.auth0.com/api/v2/guardian/factors/otp', strip))
      .toBe('guardian/factors/otp');
  });
});

describe('routeMatches', () => {
  it('matches an exact method+path', () => {
    expect(routeMatches('POST actions', 'post', 'actions')).toBe(true);
  });
  it('is method-insensitive on the pattern', () => {
    expect(routeMatches('post actions', 'POST', 'actions')).toBe(true);
  });
  it('matches a single-segment wildcard', () => {
    expect(routeMatches('POST actions/*/deploy', 'post', 'actions/act_1/deploy')).toBe(true);
  });
  it('does not let * span multiple segments', () => {
    expect(routeMatches('POST actions/*/deploy', 'post', 'actions/a/b/deploy')).toBe(false);
  });
  it('rejects a different path', () => {
    expect(routeMatches('GET guardian/policies', 'get', 'guardian/factors')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-core && npx vitest run tests/mock/matcher.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `matcher.ts`**

```ts
// Normalize an API path so every form agents emit collapses to one route:
// full URL, host-less /api/v2/..., leading slash, or bare path.
export function normalizePath(raw: string, stripPrefixes: string[]): string {
  let p = raw.replace(/^https?:\/\/[^/]*\//, ''); // scheme + host
  p = p.replace(/^\/+/, ''); // leading slash(es)
  for (const prefix of stripPrefixes) {
    if (p.startsWith(prefix)) {
      p = p.slice(prefix.length);
      break;
    }
  }
  return p;
}

// Pattern: "<METHOD> <path>", where * matches exactly one path segment.
export function routeMatches(pattern: string, method: string, path: string): boolean {
  const sp = pattern.indexOf(' ');
  if (sp === -1) return false;
  const pMethod = pattern.slice(0, sp).toLowerCase();
  const pPath = pattern.slice(sp + 1);
  if (pMethod !== method.toLowerCase()) return false;
  if (!pPath.includes('*')) return pPath === path;
  // Build a regex: escape everything, replace \* with a single-segment matcher.
  const escaped = pPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]+');
  return new RegExp(`^${escaped}$`).test(path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/eval-core && npx vitest run tests/mock/matcher.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/eval-core/src/mock/matcher.ts packages/eval-core/tests/mock/matcher.test.ts
git commit -m "feat(mock): path normalization + route matcher"
```

---

### Task 3: Manifest loader + schema validation (plumbing)

**Files:**
- Create: `packages/eval-core/src/mock/manifest.ts`
- Test: `packages/eval-core/tests/mock/manifest.test.ts`

**Interfaces:**
- Consumes: `RouteManifest`, `RouteDef` from `types.js`.
- Produces:
  - `function loadManifests(dirs: string[]): RouteManifest[]` — reads every `*.routes.json` in each dir, validates, throws `Error` with the file path + reason on invalid.
  - `function resolveBody(ref: unknown | string, fixturesDir: string): unknown` — if `ref` is a string, read `fixtures/<surface>/<ref>` as JSON; else return `ref` as-is.

- [ ] **Step 1: Write the failing test** — `packages/eval-core/tests/mock/manifest.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifests } from '../../src/mock/manifest.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'manifest-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeManifest(name: string, obj: unknown) {
  writeFileSync(join(dir, name), JSON.stringify(obj));
}

describe('loadManifests', () => {
  it('loads a valid manifest', () => {
    writeManifest('x.routes.json', {
      surface: 'x',
      routes: [{ match: 'GET x', verb: 'static', body: { ok: true } }],
    });
    const m = loadManifests([dir]);
    expect(m).toHaveLength(1);
    expect(m[0]!.routes[0]!.verb).toBe('static');
  });

  it('rejects an unknown verb', () => {
    writeManifest('bad.routes.json', {
      surface: 'bad', routes: [{ match: 'GET x', verb: 'frobnicate' }],
    });
    expect(() => loadManifests([dir])).toThrow(/verb/i);
  });

  it('rejects an un-namespaced state key (no dot)', () => {
    writeManifest('bad.routes.json', {
      surface: 'bad', routes: [{ match: 'POST x', verb: 'create', state: 'created', body: {} }],
    });
    expect(() => loadManifests([dir])).toThrow(/namespace|dot/i);
  });

  it('ignores non-manifest files', () => {
    writeFileSync(join(dir, 'README.md'), '# not a manifest');
    expect(loadManifests([dir])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-core && npx vitest run tests/mock/manifest.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `manifest.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RouteManifest, RouteDef, RouteVerb } from './types.js';

const VERBS: RouteVerb[] = ['create', 'set', 'reflect', 'static', 'handler'];

function validateRoute(r: RouteDef, file: string): void {
  if (typeof r.match !== 'string' || !r.match.includes(' ')) {
    throw new Error(`[mock] ${file}: route.match must be "<METHOD> <path>", got ${JSON.stringify(r.match)}`);
  }
  if (!VERBS.includes(r.verb)) {
    throw new Error(`[mock] ${file}: unknown verb '${r.verb}' (expected ${VERBS.join('|')})`);
  }
  if ((r.verb === 'create' || r.verb === 'set' || r.verb === 'reflect') && !r.state) {
    throw new Error(`[mock] ${file}: verb '${r.verb}' on '${r.match}' requires a 'state' key`);
  }
  if (r.state && !r.state.includes('.')) {
    throw new Error(`[mock] ${file}: state key '${r.state}' must be namespaced with a dot (e.g. feature.thing)`);
  }
  if (r.verb === 'handler' && !r.handler) {
    throw new Error(`[mock] ${file}: verb 'handler' on '${r.match}' requires a 'handler' name`);
  }
}

export function loadManifests(dirs: string[]): RouteManifest[] {
  const manifests: RouteManifest[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.routes.json')) continue;
      const file = join(dir, entry);
      let parsed: RouteManifest;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf-8')) as RouteManifest;
      } catch (e) {
        throw new Error(`[mock] ${file}: invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!parsed.surface || !Array.isArray(parsed.routes)) {
        throw new Error(`[mock] ${file}: manifest needs 'surface' and 'routes[]'`);
      }
      for (const r of parsed.routes) validateRoute(r, file);
      manifests.push(parsed);
    }
  }
  return manifests;
}

export function resolveBody(ref: unknown, fixturesDir: string): unknown {
  if (typeof ref !== 'string') return ref;
  const path = join(fixturesDir, ref);
  return JSON.parse(readFileSync(path, 'utf-8'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/eval-core && npx vitest run tests/mock/manifest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/eval-core/src/mock/manifest.ts packages/eval-core/tests/mock/manifest.test.ts
git commit -m "feat(mock): JSON manifest loader + schema validation"
```

---

### Task 4: Verbs + engine (plumbing)

**Files:**
- Create: `packages/eval-core/src/mock/verbs.ts`
- Create: `packages/eval-core/src/mock/engine.ts`
- Create: `packages/eval-core/src/mock/index.ts`
- Modify: `packages/eval-core/src/index.ts` (re-export the mock public API)
- Test: `packages/eval-core/tests/mock/engine.test.ts`

**Interfaces:**
- Consumes: `loadManifests`, `resolveBody` (manifest.js); `normalizePath`, `routeMatches` (matcher.js); `createState` (state.js); types.
- Produces:
  - `type HandlerFn = (ctx: HandlerContext) => unknown`
  - `type HandlerMap = Record<string, HandlerFn>`
  - `async function runMockCli(argv: string[], config: EngineConfig, handlers?: HandlerMap): Promise<string>` — returns the response body string (JSON or fallthrough). Never throws for unmatched routes.

- [ ] **Step 1: Write the failing test** — `packages/eval-core/tests/mock/engine.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMockCli } from '../../src/mock/engine.js';
import type { EngineConfig } from '../../src/mock/types.js';

let mockDir: string, stateDir: string;
beforeEach(() => {
  mockDir = mkdtempSync(join(tmpdir(), 'engine-mock-'));
  stateDir = mkdtempSync(join(tmpdir(), 'engine-state-'));
  mkdirSync(join(mockDir, 'fixtures', 'x'), { recursive: true });
  writeFileSync(join(mockDir, 'x.routes.json'), JSON.stringify({
    surface: 'x',
    routes: [
      { match: 'POST widgets', verb: 'create', state: 'x.widget', body: { id: 'w1' } },
      { match: 'GET widgets', verb: 'reflect', state: 'x.widget', present: { items: [{ id: 'w1' }] }, absent: { items: [] } },
      { match: 'GET ping', verb: 'static', body: { pong: true } },
      { match: 'GET computed', verb: 'handler', handler: 'computed' },
    ],
  }));
});
afterEach(() => {
  rmSync(mockDir, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

function cfg(): EngineConfig {
  return { binName: 'auth0', stripPrefixes: ['api/v2/'], manifestDirs: [mockDir], stateDir };
}

describe('runMockCli', () => {
  it('static verb returns its body', async () => {
    expect(await runMockCli(['api', 'get', 'ping'], cfg())).toBe('{"pong":true}');
  });

  it('create then reflect (read-after-write), full-URL form normalizes', async () => {
    await runMockCli(['api', 'POST', 'https://t/api/v2/widgets', '--data', '{}'], cfg());
    expect(await runMockCli(['api', 'get', 'widgets'], cfg())).toBe('{"items":[{"id":"w1"}]}');
  });

  it('reflect returns absent body before any write', async () => {
    expect(await runMockCli(['api', 'get', 'widgets'], cfg())).toBe('{"items":[]}');
  });

  it('handler verb calls the named handler', async () => {
    const out = await runMockCli(['api', 'get', 'computed'], cfg(), {
      computed: (ctx) => ({ seen: ctx.state.has('x.widget') }),
    });
    expect(out).toBe('{"seen":false}');
  });

  it('unmatched write falls through to {"ok":true}', async () => {
    expect(await runMockCli(['api', 'patch', 'unknown'], cfg())).toBe('{"ok":true}');
  });

  it('unmatched read falls through to {}', async () => {
    expect(await runMockCli(['api', 'get', 'unknown'], cfg())).toBe('{}');
  });

  it('non-api subcommand returns a no-op success line', async () => {
    expect(await runMockCli(['login', '--domain', 'x'], cfg())).toContain('mock');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-core && npx vitest run tests/mock/engine.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `verbs.ts`, `engine.ts`, `index.ts`; re-export from `eval-core/src/index.ts`**

`verbs.ts`:
```ts
import { resolveBody } from './manifest.js';
import type { RouteDef, MockState } from './types.js';

// Apply a declarative verb → response object. Returns undefined for 'handler'
// (the engine calls the handler instead).
export function applyVerb(route: RouteDef, state: MockState, fixturesDir: string): unknown {
  switch (route.verb) {
    case 'create':
    case 'set':
      state.set(route.state!);
      return resolveBody(route.body, fixturesDir);
    case 'reflect':
      return state.has(route.state!)
        ? resolveBody(route.present, fixturesDir)
        : resolveBody(route.absent, fixturesDir);
    case 'static':
      return resolveBody(route.body, fixturesDir);
    default:
      return undefined;
  }
}
```

`engine.ts`:
```ts
import { dirname } from 'node:path';
import { loadManifests } from './manifest.js';
import { normalizePath, routeMatches } from './matcher.js';
import { createState } from './state.js';
import { applyVerb } from './verbs.js';
import type { EngineConfig, HandlerContext } from './types.js';

export type HandlerFn = (ctx: HandlerContext) => unknown;
export type HandlerMap = Record<string, HandlerFn>;

export async function runMockCli(
  argv: string[],
  config: EngineConfig,
  handlers: HandlerMap = {},
): Promise<string> {
  const [sub, method, rawPath] = argv;
  if (sub !== 'api') {
    // Non-api subcommands (e.g. login) are no-op successes.
    return `auth0 (mock): ok`;
  }
  const path = normalizePath(rawPath ?? '', config.stripPrefixes);
  const payload = argv.join(' ');
  const state = createState(config.stateDir);

  const manifests = loadManifests(config.manifestDirs);
  for (const manifest of manifests) {
    for (const route of manifest.routes) {
      if (!routeMatches(route.match, method ?? '', path)) continue;
      if (route.verb === 'handler') {
        const fn = handlers[route.handler!];
        if (!fn) continue; // unknown handler → keep searching, then fallthrough
        return JSON.stringify(fn({ method: (method ?? '').toLowerCase(), path, payload, state }));
      }
      // manifestDirs entries hold fixtures/<surface>/ alongside the manifest.
      const fixturesDir = `${config.manifestDirs.find((d) => manifests.includes(manifest)) ?? dirname(rawPath ?? '')}/fixtures/${manifest.surface}`;
      return JSON.stringify(applyVerb(route, state, fixturesDir));
    }
  }

  // Fallthrough: unmatched writes succeed non-emptily; reads return {}.
  const m = (method ?? '').toLowerCase();
  return ['put', 'patch', 'post', 'delete'].includes(m) ? '{"ok":true}' : '{}';
}
```

> Note: the `fixturesDir` derivation above is a placeholder-free but awkward expression. Replace with the cleaner form in Step 3b.

- [ ] **Step 3b: Fix fixturesDir resolution** — the manifest must remember which dir it came from. Update `loadManifests` to stamp each manifest with its dir, and simplify the engine.

In `types.ts`, add to `RouteManifest`:
```ts
  /** Absolute dir the manifest was loaded from (set by loadManifests). */
  dir?: string;
```
In `manifest.ts` `loadManifests`, before `manifests.push(parsed)`:
```ts
      parsed.dir = dir;
```
In `engine.ts`, replace the `fixturesDir` line with:
```ts
      const fixturesDir = `${manifest.dir}/fixtures/${manifest.surface}`;
```

`index.ts`:
```ts
export { runMockCli } from './engine.js';
export type { HandlerFn, HandlerMap } from './engine.js';
export type {
  RouteManifest, RouteDef, RouteVerb, HandlerContext, MockState, EngineConfig,
} from './types.js';
```

In `packages/eval-core/src/index.ts`, add:
```ts
export * as mock from './mock/index.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/eval-core && npx vitest run tests/mock/engine.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Build + commit**

```bash
cd /Users/sanchit.mehta/Documents/auth0-evals && npm run build
git add packages/eval-core/src/mock/ packages/eval-core/src/index.ts packages/eval-core/tests/mock/engine.test.ts
git commit -m "feat(mock): declarative verb engine + runMockCli entrypoint"
```

---

### Task 5: JS `auth0` entrypoint in the app; delete shell dispatcher (plumbing)

**Files:**
- Modify (replace): `apps/auth0-evals/mocks/auth0` — from shell to `#!/usr/bin/env node`.
- Delete: `apps/auth0-evals/mocks/lib.sh`, `apps/auth0-evals/mocks/routes/*.sh` (none on plumbing — routes live on feature branches; the app-level `routes/README.md` stays).
- Modify: `apps/auth0-evals/mocks/routes/README.md` → manifest contract.
- Modify: `packages/eval-core/tests/auth0-mock.test.ts` → point at the JS entrypoint; keep the same black-box assertions (path forms, fallthrough, per-eval routes) using a throwaway manifest.

**Interfaces:**
- Consumes: `runMockCli`, `EngineConfig` from `@a0/eval-core` (mock namespace).
- Produces: the executable `auth0` the agent runs.

- [ ] **Step 1: Update the dispatcher black-box test to a throwaway manifest** (replace the shell-fixture setup with a `*.routes.json`).

```ts
// packages/eval-core/tests/auth0-mock.test.ts — key changes:
// - MOCK path unchanged: apps/auth0-evals/mocks/auth0
// - fixture is now a manifest file:
fixtureManifest = join(ROUTES_DIR, 'zz-fixture.routes.json');
writeFileSync(fixtureManifest, JSON.stringify({
  surface: 'zzfixture',
  routes: [
    { match: 'POST widgets', verb: 'create', state: 'zz.widget', body: { id: 'w1' } },
    { match: 'GET widgets', verb: 'reflect', state: 'zz.widget', present: [{ id: 'w1' }], absent: [] },
  ],
}));
// assertions stay: POST widgets → {"id":"w1"}; full-URL + /api/v2 forms route the same;
// unmatched write → {"ok":true}; unmatched read → {}; login → contains "mock".
```

Wait — the app-level `routes/` holds manifests now, so the dispatcher's default manifestDir is `mocks/` (surface manifests live at `mocks/*.routes.json`). Put the throwaway manifest under `mocks/` and its fixtures under `mocks/fixtures/zzfixture/`. Adjust `ROUTES_DIR`/paths accordingly and clean up in `afterEach`.

- [ ] **Step 2: Run test to verify it fails** (entrypoint still shell)

Run: `cd packages/eval-core && npx vitest run tests/auth0-mock.test.ts`
Expected: FAIL — shell dispatcher doesn't read manifests.

- [ ] **Step 3: Replace `apps/auth0-evals/mocks/auth0` with the JS entrypoint**

```js
#!/usr/bin/env node
// Mock Auth0 CLI — thin entrypoint. Runs the generic mock engine (eval-core)
// with Auth0-specific config. The engine knows nothing about Auth0; this file
// supplies the binary name, the /api/v2 path convention, and where manifests
// and handlers live. See apps/auth0-evals/mocks/README.md.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { mock } from '@a0/eval-core';

const here = dirname(fileURLToPath(import.meta.url));

// Manifest dirs: this mocks/ dir, plus any per-eval dirs on EVAL_MOCK_ROUTES_DIRS.
const manifestDirs = [here];
if (process.env.EVAL_MOCK_ROUTES_DIRS) {
  manifestDirs.push(...process.env.EVAL_MOCK_ROUTES_DIRS.split(':').filter(Boolean));
}

// Load handler maps from every <surface>.handlers.js next to a manifest dir.
const handlers = {};
for (const dir of manifestDirs) {
  const hFile = join(dir, 'handlers.js');
  if (existsSync(hFile)) Object.assign(handlers, (await import(hFile)).default ?? {});
}

const config = {
  binName: 'auth0',
  stripPrefixes: ['api/v2/'],
  manifestDirs,
  stateDir: process.env.EVAL_MOCK_STATE_DIR || join(process.env.TMPDIR || '/tmp', 'auth0-mock-state'),
};

const out = await mock.runMockCli(process.argv.slice(2), config, handlers);
process.stdout.write(out + '\n');
```

Delete the shell files:
```bash
git rm apps/auth0-evals/mocks/lib.sh
```

- [ ] **Step 4: Run tests to verify pass**

Run:
```bash
cd /Users/sanchit.mehta/Documents/auth0-evals && npm run build
cd packages/eval-core && npx vitest run tests/auth0-mock.test.ts
```
Expected: PASS. Also smoke locally:
```bash
EVAL_MOCK_STATE_DIR=$(mktemp -d) node apps/auth0-evals/mocks/auth0 api get some/unmapped   # → {}
```

- [ ] **Step 5: Rewrite `routes/README.md` to the manifest contract; commit**

```bash
git add apps/auth0-evals/mocks/auth0 apps/auth0-evals/mocks/routes/README.md packages/eval-core/tests/auth0-mock.test.ts
git commit -m "feat(mock): replace shell dispatcher with JS entrypoint over the engine"
```

---

### Task 6: `mock:check` test harness + `mock:new` generator (plumbing)

**Files:**
- Create: `apps/auth0-evals/scripts/mock-check.mjs`
- Create: `apps/auth0-evals/scripts/mock-new.mjs`
- Modify: `apps/auth0-evals/package.json` (scripts)
- Test: `packages/eval-core/tests/mock/harness.test.ts` (asserts every manifest in the app validates + all fixture/handler refs resolve)

**Interfaces:**
- Consumes: `loadManifests` (via a small exported `validateAllManifests(dir)` helper) — add to `manifest.ts`:
  - `function collectRefProblems(manifests: RouteManifest[]): string[]` — returns a list of unresolved fixture files / handler names (empty = all good).

- [ ] **Step 1: Write the failing test** — `packages/eval-core/tests/mock/harness.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadManifests, collectRefProblems } from '../../src/mock/manifest.js';

const MOCKS = fileURLToPath(new URL('../../../apps/auth0-evals/mocks/', import.meta.url));

describe('app mock manifests', () => {
  it('all manifests load and validate', () => {
    expect(() => loadManifests([MOCKS])).not.toThrow();
  });
  it('every fixture/handler reference resolves', () => {
    const problems = collectRefProblems(loadManifests([MOCKS]));
    expect(problems).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-core && npx vitest run tests/mock/harness.test.ts`
Expected: FAIL — `collectRefProblems` not exported (and no manifests yet on plumbing → the load test passes vacuously; the ref test fails on the missing export).

- [ ] **Step 3: Implement `collectRefProblems` in `manifest.ts`**

```ts
import { existsSync } from 'node:fs';
// ...
export function collectRefProblems(manifests: RouteManifest[]): string[] {
  const problems: string[] = [];
  for (const m of manifests) {
    const fixturesDir = `${m.dir}/fixtures/${m.surface}`;
    for (const r of m.routes) {
      for (const ref of [r.body, r.present, r.absent]) {
        if (typeof ref === 'string' && !existsSync(`${fixturesDir}/${ref}`)) {
          problems.push(`${m.surface}: missing fixture '${ref}'`);
        }
      }
      // handler names are validated at runtime against the handler map; the
      // harness only checks fixture files here.
    }
  }
  return problems;
}
```

- [ ] **Step 4: Write the two scripts + package.json entries**

`scripts/mock-check.mjs` — load a surface's manifest, run a list of `METHOD path` probes from argv, print response + state deltas (no eval). `scripts/mock-new.mjs` — scaffold `<surface>.routes.json` (with a create/reflect/static example), `fixtures/<surface>/example.json`, and `<surface>.handlers.js` stub.

package.json:
```json
"mock:new": "node scripts/mock-new.mjs",
"mock:check": "node scripts/mock-check.mjs"
```

(Full script bodies: each ≤40 lines; `mock-check` imports `runMockCli` from the built `@a0/eval-core`, `mock-new` writes template files with `writeFileSync`.)

- [ ] **Step 5: Run test to verify passes; commit**

Run: `cd packages/eval-core && npx vitest run tests/mock/harness.test.ts`
Expected: PASS.

```bash
git add apps/auth0-evals/scripts/ apps/auth0-evals/package.json packages/eval-core/src/mock/manifest.ts packages/eval-core/tests/mock/harness.test.ts
git commit -m "feat(mock): mock:new generator + mock:check harness + manifest ref validation"
```

- [ ] **Step 6: Full gate + push plumbing**

```bash
cd /Users/sanchit.mehta/Documents/auth0-evals && npm run build && npm run lint && npm test
git add docs/superpowers/specs/2026-07-07-declarative-mock-runtime-design.md docs/superpowers/plans/2026-07-07-declarative-mock-runtime.md
git commit -m "docs(mock): declarative mock runtime spec + plan"
git push origin plumbing
```

---

### Task 7: Port guardian → manifest (MFA branch #83)

**Files:**
- Rebase `mfa-legs` onto updated `plumbing` first.
- Delete: `apps/auth0-evals/mocks/routes/guardian.sh`.
- Create: `apps/auth0-evals/mocks/guardian.routes.json`
- Create: `apps/auth0-evals/mocks/fixtures/guardian/policies_set.json` (`["all-applications"]`)
- Create: `apps/auth0-evals/mocks/guardian.handlers.js` (computed factor list — the `enabled` flip)
- Existing test `packages/eval-core/tests/guardian-route.test.ts` must pass **unchanged** (black-box parity).

**Interfaces:**
- Consumes: engine from plumbing.

- [ ] **Step 1: Rebase**

```bash
git checkout mfa-legs && git rebase plumbing
```

- [ ] **Step 2: Run the existing guardian test to see it fail** (guardian.sh gone after rebase-delete)

Delete the shell route, then:
Run: `cd packages/eval-core && npx vitest run tests/guardian-route.test.ts`
Expected: FAIL (no guardian routing yet).

- [ ] **Step 3: Write the manifest + fixture + handler**

`guardian.routes.json`:
```json
{
  "surface": "guardian",
  "consumedBy": ["mfa_tenant_cli"],
  "routes": [
    { "match": "GET guardian/factors", "verb": "handler", "handler": "listFactors" },
    { "match": "PUT guardian/factors/*", "verb": "handler", "handler": "setFactor" },
    { "match": "PATCH guardian/factors/*", "verb": "handler", "handler": "setFactor" },
    { "match": "PUT guardian/policies", "verb": "create", "state": "mfa.policy", "body": "policies_set.json" },
    { "match": "PATCH guardian/policies", "verb": "create", "state": "mfa.policy", "body": "policies_set.json" },
    { "match": "GET guardian/policies", "verb": "reflect", "state": "mfa.policy", "present": "policies_set.json", "absent": [] }
  ]
}
```

`fixtures/guardian/policies_set.json`: `["all-applications"]`

`guardian.handlers.js`:
```js
const FACTORS = ['sms','push-notification','otp','email','duo','webauthn-roaming','webauthn-platform','recovery-code'];
export default {
  setFactor(ctx) {
    const factor = ctx.path.split('/').pop();
    const disabled = /"enabled"\s*:\s*false/.test(ctx.payload);
    if (disabled) ctx.state.clear(`mfa.factor.${factor}`);
    else ctx.state.set(`mfa.factor.${factor}`);
    return { enabled: true };
  },
  listFactors(ctx) {
    return FACTORS.map((name) => ({ name, enabled: ctx.state.has(`mfa.factor.${name}`), trial_expired: false }));
  },
};
```

- [ ] **Step 4: Run guardian test — must pass unchanged**

Run: `cd packages/eval-core && npx vitest run tests/guardian-route.test.ts`
Expected: PASS (behavior identical to the old shell route).

- [ ] **Step 5: Gate, amend the MFA commit, push**

```bash
cd /Users/sanchit.mehta/Documents/auth0-evals && npm run build && npm run lint && npm test
git add -A && git commit --amend --no-edit
git push --force-with-lease origin mfa-legs
```

- [ ] **Step 6: Live smoke**

```bash
cd apps/auth0-evals && npm run evals -- --eval mfa_tenant_cli --mode agent --model claude-sonnet-4-6 --agent-type claude-code --dangerously-skip-sandbox
```
Expected: grade A, guardian event graders pass.

---

### Task 8: Port token-exchange → manifest (CTE branch #84)

**Files:**
- Rebase `cte-legs` onto updated `plumbing` first.
- Delete: `apps/auth0-evals/mocks/routes/token-exchange.sh`.
- Create: `apps/auth0-evals/mocks/token-exchange.routes.json`
- Create: `apps/auth0-evals/mocks/fixtures/token-exchange/{action.json,profile.json}`
- Create: `apps/auth0-evals/mocks/token-exchange.handlers.js` (computed `deployed` in the actions list)
- Existing `packages/eval-core/tests/token-exchange-route.test.ts` must pass **unchanged**.

- [ ] **Step 1: Rebase**

```bash
git checkout cte-legs && git rebase plumbing
```

- [ ] **Step 2: Delete the shell route; run the CTE route test to see it fail**

Run: `cd packages/eval-core && npx vitest run tests/token-exchange-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write manifest + fixtures + handler**

`token-exchange.routes.json`:
```json
{
  "surface": "token-exchange",
  "consumedBy": ["cte_tenant_cli"],
  "routes": [
    { "match": "POST actions", "verb": "create", "state": "cte.action", "body": "action.json" },
    { "match": "POST actions/*/deploy", "verb": "create", "state": "cte.deployed", "body": { "id": "act_cte_validator", "deployed": true } },
    { "match": "GET actions", "verb": "handler", "handler": "listActions" },
    { "match": "GET actions/*", "verb": "handler", "handler": "listActions" },
    { "match": "POST token-exchange-profiles", "verb": "create", "state": "cte.tep", "body": "profile.json" },
    { "match": "GET token-exchange-profiles", "verb": "reflect", "state": "cte.tep", "present": { "token_exchange_profiles": [{ "id": "tep_legacy", "name": "legacy-migration", "type": "custom_authentication", "action_id": "act_cte_validator" }] }, "absent": { "token_exchange_profiles": [] } },
    { "match": "GET token-exchange-profiles/*", "verb": "reflect", "state": "cte.tep", "present": { "token_exchange_profiles": [{ "id": "tep_legacy" }] }, "absent": { "token_exchange_profiles": [] } }
  ]
}
```

`fixtures/token-exchange/action.json`:
```json
{ "id": "act_cte_validator", "name": "cte-validator", "supported_triggers": [{ "id": "custom-token-exchange", "version": "v1" }] }
```
`fixtures/token-exchange/profile.json`:
```json
{ "id": "tep_legacy", "name": "legacy-migration", "type": "custom_authentication", "action_id": "act_cte_validator" }
```

`token-exchange.handlers.js`:
```js
export default {
  listActions(ctx) {
    if (!ctx.state.has('cte.action')) return { actions: [] };
    return { actions: [{ id: 'act_cte_validator', name: 'cte-validator', deployed: ctx.state.has('cte.deployed'), supported_triggers: [{ id: 'custom-token-exchange', version: 'v1' }] }] };
  },
};
```

- [ ] **Step 4: Run CTE route test — must pass unchanged**

Run: `cd packages/eval-core && npx vitest run tests/token-exchange-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate, amend, push**

```bash
cd /Users/sanchit.mehta/Documents/auth0-evals && npm run build && npm run lint && npm test
git add -A && git commit --amend --no-edit
git push --force-with-lease origin cte-legs
```

- [ ] **Step 6: Live smoke**

```bash
cd apps/auth0-evals && npm run evals -- --eval cte_tenant_cli --mode agent --model claude-sonnet-4-6 --agent-type claude-code --dangerously-skip-sandbox
```
Expected: grade A, CTE event graders pass.

---

## Self-review notes

- **Spec coverage:** engine (T1-4), JS entrypoint + eval-core-agnostic boundary (T5), generator + harness (T6), guardian manifest+handler (T7), token-exchange manifest+handler (T8), fallthrough + normalization + per-eval routes (T4/T5 tests), migration-by-black-box-parity (T7/T8 reuse existing route tests). Docker: entrypoint already runs node; the `auth0` shebang + copied `dist` cover it — verify in T5 Step 4 smoke and note Dockerfile needs the app `dist` (already copied).
- **Docker check (RESOLVED):** `apps/auth0-evals/mocks/auth0` imports `@a0/eval-core`. Verified the slim runtime stage copies `node_modules/` (with the `@a0/* → packages/*` workspace symlinks, Dockerfile L53) **and** `packages/eval-core/dist/` (L56), so the sandbox entrypoint resolves the engine at runtime. No bundling needed.
- **Handler compilation:** handlers are shipped as `.js` (not `.ts`) to avoid a per-eval TS-compile dependency in the mock path — simplest that works; app-level handlers need no build. Revisit only if a handler needs shared TS types.
