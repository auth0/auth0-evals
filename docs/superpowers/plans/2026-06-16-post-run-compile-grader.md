# Post-run Compile Grader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run an eval's `compile_command` against the workspace after the agent finishes and drive a new `compiles()` grader from the captured result, so agents are graded on whether their output compiles — not on whether they ran the build themselves.

**Architecture:** Add a non-throwing `runCompileCommand` helper (orchestration layer) that runs `compile_command` between `runner.run` and `runGraders` in both the host (`run.ts`) and container (`sandbox-runner.ts`) paths. It returns a `CompileResult` that is threaded through `runGraders` → `GraderContext` and consumed by a new `compile` grader executor. Eval authors opt in by declaring `compiles(description, level)` in `graders.ts`. The grader reuses the eval's existing `compile_command` frontmatter — single source of truth.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Node `child_process.spawnSync`, Vitest. Monorepo packages: `@a0/eval-graders` (types + primitive), `@a0/eval-core` (executor, engine, workspace helper, config), `@a0/eval` (orchestration wiring).

---

## File Structure

**`packages/eval-graders/`** — pure descriptors + types, no Node/fs:
- `src/types.ts` (modify): add `CompileResult` interface.
- `src/primitives.ts` (modify): add `compiles()` factory.
- `src/index.ts` (modify): export `compiles` and `CompileResult`.
- `tests/primitives.test.ts` (modify): test `compiles()` shape + level validation.

**`packages/eval-core/`** — execution engine + workspace + config:
- `src/graders/executors/types.ts` (modify): add `compileResult?` to `GraderContext`.
- `src/graders/executors/compile.ts` (create): `compileExecutor`.
- `src/graders/engine.ts` (modify): register executor, add `compileResult` param to `runGraders`, put it in context.
- `src/workspace/workspace.ts` (modify): add non-throwing `runCompileCommand` + `RunCompileCommandOptions`.
- `src/workspace/index.ts` (modify): export `runCompileCommand` + option type.
- `src/index.ts` (modify): re-export `runCompileCommand`, `RunCompileCommandOptions`, and `CompileResult` type.
- `src/config/framework.ts` (modify): add `compileCommandTimeoutMs?` to `WorkspaceConfig`.
- `src/config/defaults.ts` (modify): default `compileCommandTimeoutMs: 300_000`.
- `tests/workspace-commands.test.ts` (modify): test `runCompileCommand`.
- `tests/graders/executors.test.ts` (modify): test `compile` grader via `runGraders`.

**`packages/eval/`** — orchestration:
- `src/cli/run.ts` (modify): run compile between `runner.run` and `runGraders` (host path).
- `src/cli/sandbox-runner.ts` (modify): same (container path).

**`apps/auth0-evals/`** — eval definitions:
- `src/evals/quickstarts/{react,vue,angular,spa-js,nextjs,nuxt}/graders.ts` (modify): replace commented `ranCommand` build line with real `compiles(...)`.

**Docs:**
- `AGENTS.md`, `docs/ADDING_EVALS.md` (modify).

---

## Task 1: `CompileResult` type

**Files:**
- Modify: `packages/eval-graders/src/types.ts`

- [ ] **Step 1: Add the `CompileResult` interface**

Append after the `EventToolCall` interface (after line 19) in `packages/eval-graders/src/types.ts`:

```typescript
/** Outcome of running an eval's compile_command against the workspace post-agent. */
export interface CompileResult {
  /** True only if every sub-command exited 0. */
  ok: boolean;
  /** Exit code of the failing (or last) sub-command; null if killed by signal. */
  exitCode: number | null;
  /** Signal that killed the command (e.g. 'SIGTERM' on timeout); null otherwise. */
  signal: string | null;
  /** Combined stdout+stderr of the command run. */
  output: string;
  /** The compile_command string that was executed. */
  command: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build --workspace=@a0/eval-graders`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add packages/eval-graders/src/types.ts
git commit -m "feat(graders): add CompileResult type"
```

---

## Task 2: `compiles()` grader primitive

**Files:**
- Modify: `packages/eval-graders/src/primitives.ts`
- Modify: `packages/eval-graders/src/index.ts`
- Test: `packages/eval-graders/tests/primitives.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/eval-graders/tests/primitives.test.ts`. The file imports primitives from `../src/primitives.js` and `GraderLevel` from `../src/types.js`. Add `compiles` to the existing `../src/primitives.js` import (it becomes `import { contains, notContains, notContainsInSource, matches, judge, compiles } from '../src/primitives.js';`). `GraderLevel` is already imported. Then add this describe block at the end of the file:

```typescript
describe('compiles', () => {
  it('returns a compile-kind grader with the given level and name', () => {
    const g = compiles('verifies the build', GraderLevel.L4);
    expect(g.kind).toBe('compile');
    expect(g.level).toBe(GraderLevel.L4);
    expect(g.name).toBe('verifies the build');
    expect(g.predicate).toBeUndefined();
  });

  it('falls back to a default name when description is omitted', () => {
    const g = compiles(undefined, GraderLevel.L4);
    expect(g.name).toBe('compiles successfully');
  });

  it('accepts L5', () => {
    expect(compiles('build', GraderLevel.L5).level).toBe(GraderLevel.L5);
  });

  it('rejects non-event levels', () => {
    // @ts-expect-error — L1 is not an EventGraderLevel
    expect(() => compiles('build', GraderLevel.L1)).toThrow('event-based graders only support');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@a0/eval-graders -- primitives`
Expected: FAIL with "compiles is not defined" (or import error).

- [ ] **Step 3: Implement `compiles()`**

Append to `packages/eval-graders/src/primitives.ts` (after `wroteFile`, end of file). It reuses the existing `validateEventLevel` helper defined earlier in the file:

```typescript
/**
 * Asserts that the eval's compile_command succeeds when run against the workspace
 * after the agent finishes. The framework runs the command and captures the result;
 * this grader reads it. The command comes from the eval's `compile_command`
 * frontmatter, so no command argument is needed here.
 */
export function compiles(description: string | undefined, level: EventGraderLevel): GraderDef {
  validateEventLevel(level, 'compiles');
  return {
    kind: 'compile',
    name: description ?? 'compiles successfully',
    level,
  };
}
```

- [ ] **Step 4: Export from the package barrel**

In `packages/eval-graders/src/index.ts`, add `compiles` to the factory-function export block and `CompileResult` to the type export line:

```typescript
export type { GraderResult, GraderDef, GraderOptions, EventToolCall, EventGraderLevel, CompileResult } from './types.js';

export {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  ranCommand,
  ranCommandOneOf,
  wroteFile,
  compiles,
} from './primitives.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace=@a0/eval-graders -- primitives`
Expected: PASS (all `compiles` cases green).

- [ ] **Step 6: Commit**

```bash
git add packages/eval-graders/src/primitives.ts packages/eval-graders/src/index.ts packages/eval-graders/tests/primitives.test.ts
git commit -m "feat(graders): add compiles() grader primitive"
```

---

## Task 3: `compileResult` on `GraderContext`

**Files:**
- Modify: `packages/eval-core/src/graders/executors/types.ts`

- [ ] **Step 1: Add the context field**

In `packages/eval-core/src/graders/executors/types.ts`:

Update the type import on line 8 to include `CompileResult`:

```typescript
import type { GraderDef, GraderResult, EventToolCall, CompileResult } from '@a0/eval-graders';
```

Then add this field immediately after the `toolCalls` field (after line 43, before the closing brace of `GraderContext`):

```typescript
  /** Result of running the eval's compile_command post-agent — used by the compile grader. */
  compileResult?: CompileResult;
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build --workspace=@a0/eval-core`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/eval-core/src/graders/executors/types.ts
git commit -m "feat(core): thread compileResult through GraderContext"
```

---

## Task 4: `compile` grader executor

**Files:**
- Create: `packages/eval-core/src/graders/executors/compile.ts`
- Modify: `packages/eval-core/src/graders/engine.ts`
- Test: `packages/eval-core/tests/graders/executors.test.ts`

- [ ] **Step 1: Write the failing test**

This file tests executors by importing each executor directly and calling `.execute(def, ctx)` — it uses local `makeDef`/`makeCtx` helpers and does NOT import `executeGrader`. Match that style.

At the top of `packages/eval-core/tests/graders/executors.test.ts`:
- Add `type CompileResult` to the `@a0/eval-graders` type import (line 3 currently imports `type { GraderDef }`):
  ```typescript
  import type { GraderDef, CompileResult } from '@a0/eval-graders';
  ```
- Add the new executor import alongside the others (after the `matchesExecutor` import line):
  ```typescript
  import { compileExecutor } from '../../src/graders/executors/compile.js';
  ```

Then add this describe block at the end of the file (it reuses the file's existing `makeCtx` and `makeDef` helpers):

```typescript
describe('compile executor', () => {
  it('passes when compileResult.ok is true', async () => {
    const def = makeDef({ kind: 'compile', level: GraderLevel.L4 });
    const compileResult: CompileResult = {
      ok: true,
      exitCode: 0,
      signal: null,
      output: 'done',
      command: 'npm run build',
    };
    const res = await compileExecutor.execute(def, { ...makeCtx({}), compileResult });
    expect(res.passed).toBe(true);
    expect(res.kind).toBe('compile');
  });

  it('fails when compileResult.ok is false and includes exit code + output tail in detail', async () => {
    const def = makeDef({ kind: 'compile', level: GraderLevel.L4 });
    const compileResult: CompileResult = {
      ok: false,
      exitCode: 2,
      signal: null,
      output: 'TS2304: Cannot find name foo',
      command: 'npm run build',
    };
    const res = await compileExecutor.execute(def, { ...makeCtx({}), compileResult });
    expect(res.passed).toBe(false);
    expect(res.detail).toContain('2');
    expect(res.detail).toContain('TS2304');
  });

  it('fails when no compileResult is present (eval misconfigured)', async () => {
    const def = makeDef({ kind: 'compile', level: GraderLevel.L4 });
    const res = await compileExecutor.execute(def, makeCtx({}));
    expect(res.passed).toBe(false);
    expect(res.detail).toContain('compile was not run');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@a0/eval-core -- executors`
Expected: FAIL — `../../src/graders/executors/compile.js` does not exist yet (module-not-found import error).

- [ ] **Step 3: Create the executor**

Create `packages/eval-core/src/graders/executors/compile.ts`:

```typescript
/**
 * Grader executor: compile
 *
 * Evaluates the result of running the eval's compile_command against the
 * workspace after the agent finishes. The framework runs the command and
 * populates ctx.compileResult before grading.
 */

import type { GraderDef, GraderResult } from '@a0/eval-graders';
import type { GraderContext, GraderExecutor } from './types.js';

const MAX_OUTPUT_TAIL = 500;

export const compileExecutor: GraderExecutor = {
  kind: 'compile',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    const result = ctx.compileResult;
    if (result === undefined) {
      return {
        name: def.name,
        kind: def.kind,
        passed: false,
        detail: 'compile was not run (no compile_command declared for this eval)',
        level: def.level,
      };
    }

    if (result.ok) {
      return {
        name: def.name,
        kind: def.kind,
        passed: true,
        detail: `compile_command '${result.command}' succeeded`,
        level: def.level,
      };
    }

    const tail = result.output.slice(-MAX_OUTPUT_TAIL);
    const cause = result.signal ? `signal ${result.signal}` : `exit code ${result.exitCode}`;
    return {
      name: def.name,
      kind: def.kind,
      passed: false,
      detail: `compile_command '${result.command}' failed (${cause}): ${tail}`,
      level: def.level,
    };
  },
};
```

- [ ] **Step 4: Register the executor**

In `packages/eval-core/src/graders/engine.ts`, add the import alongside the other executor imports (after line 23):

```typescript
import { compileExecutor } from './executors/compile.js';
```

And register it alongside the others (after line 35, `registerExecutor(eventExecutor);`):

```typescript
registerExecutor(compileExecutor);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace=@a0/eval-core -- executors`
Expected: PASS (all three compile-executor cases green).

- [ ] **Step 6: Commit**

```bash
git add packages/eval-core/src/graders/executors/compile.ts packages/eval-core/src/graders/engine.ts packages/eval-core/tests/graders/executors.test.ts
git commit -m "feat(core): add compile grader executor"
```

---

## Task 5: `compileResult` param on `runGraders`

**Files:**
- Modify: `packages/eval-core/src/graders/engine.ts`
- Test: `packages/eval-core/tests/graders/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/eval-core/tests/graders/engine.test.ts`. Ensure `compiles` and `type CompileResult` are in the `@a0/eval-graders` import at the top (add if missing). Add this describe block at the end:

```typescript
describe('runGraders - compile', () => {
  it('passes the compile grader through to the compile executor via compileResult', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'index.ts'), 'export const x = 1;');
    const compileResult: CompileResult = {
      ok: true,
      exitCode: 0,
      signal: null,
      output: '',
      command: 'npm run build',
    };
    const results = await runGraders(
      [compiles('builds', GraderLevel.L4)],
      dir,
      'test-key',
      undefined,
      undefined,
      true,
      undefined,
      compileResult,
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
  });

  it('fails the compile grader when no compileResult is threaded', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'index.ts'), 'export const x = 1;');
    const results = await runGraders([compiles('builds', GraderLevel.L4)], dir, 'test-key');
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.detail).toContain('compile was not run');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@a0/eval-core -- graders/engine`
Expected: FAIL — `runGraders` accepts 7 args, so the 8th (`compileResult`) is a type error / ignored; first test fails because `compileResult` never reaches the context.

- [ ] **Step 3: Add the parameter and thread it into the context**

In `packages/eval-core/src/graders/engine.ts`:

Add `CompileResult` to the type import on line 15:

```typescript
import type { GraderDef, GraderResult, EventToolCall, CompileResult } from '@a0/eval-graders';
```

Add the parameter to the `runGraders` signature (after `toolCalls?: EventToolCall[],` on line 118):

```typescript
  toolCalls?: EventToolCall[],
  compileResult?: CompileResult,
): Promise<GraderResult[]> {
```

Add `compileResult` to the `context` object (after `toolCalls,` on line 149):

```typescript
    toolCalls,
    compileResult,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=@a0/eval-core -- graders/engine`
Expected: PASS (both compile cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/eval-core/src/graders/engine.ts packages/eval-core/tests/graders/engine.test.ts
git commit -m "feat(core): add compileResult parameter to runGraders"
```

---

## Task 6: `runCompileCommand` workspace helper + config

**Files:**
- Modify: `packages/eval-core/src/config/framework.ts`
- Modify: `packages/eval-core/src/config/defaults.ts`
- Modify: `packages/eval-core/src/workspace/workspace.ts`
- Modify: `packages/eval-core/src/workspace/index.ts`
- Modify: `packages/eval-core/src/index.ts`
- Test: `packages/eval-core/tests/workspace-commands.test.ts`

- [ ] **Step 1: Add config field**

In `packages/eval-core/src/config/framework.ts`, add to `WorkspaceConfig` (after the `setupCommandTimeoutMs?` field, ~line 101):

```typescript
  /** Timeout (ms) for the post-agent compile_command. Builds are slower than installs. */
  compileCommandTimeoutMs?: number;
```

In `packages/eval-core/src/config/defaults.ts`, add to the `workspace` block (after `setupCommandTimeoutMs: 300_000,`, line 36):

```typescript
    compileCommandTimeoutMs: 300_000,
```

- [ ] **Step 2: Write the failing test**

Add to `packages/eval-core/tests/workspace-commands.test.ts`. Add `runCompileCommand` to the import from `../src/workspace/workspace.js` (line 12). Then add this describe block after the `runSetupCommand` block:

```typescript
describe('runCompileCommand', () => {
  it('returns ok:true with exit code 0 on success', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'true');
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.command).toBe('true');
  });

  it('returns ok:false WITHOUT throwing on non-zero exit', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'false');
    expect(res.ok).toBe(false);
    expect(res.exitCode).not.toBe(0);
  });

  it('captures combined stdout/stderr output', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'echo hello-build');
    expect(res.output).toContain('hello-build');
  });

  it('returns ok:false for a missing command without throwing', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'nonexistent_command_xyz');
    expect(res.ok).toBe(false);
  });

  it('short-circuits an &&-chain on first failure', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'false && touch should_not_exist.txt');
    expect(res.ok).toBe(false);
    expect(existsSync(join(dir, 'should_not_exist.txt'))).toBe(false);
  });

  it('returns ok:true when every sub-command in an &&-chain succeeds', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'mkdir sub && touch sub/built.txt');
    expect(res.ok).toBe(true);
    expect(existsSync(join(dir, 'sub/built.txt'))).toBe(true);
  });

  it('records the signal and ok:false on timeout', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, 'sleep 10', { timeoutMs: 100 });
    expect(res.ok).toBe(false);
    expect(res.signal).not.toBeNull();
  });

  it('returns ok:false for an empty command', () => {
    const dir = tmpDir();
    const res = runCompileCommand(dir, '');
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --workspace=@a0/eval-core -- workspace-commands`
Expected: FAIL with "runCompileCommand is not a function" / import error.

- [ ] **Step 4: Implement `runCompileCommand`**

In `packages/eval-core/src/workspace/workspace.ts`:

Add `CompileResult` to imports — add this near the top with the other type imports (the file already imports from `node:*` and local modules; add a type import):

```typescript
import type { CompileResult } from '@a0/eval-graders';
```

Add the options interface after `RunSetupCommandOptions` (after line 84):

```typescript
export interface RunCompileCommandOptions {
  /** Timeout in ms for the compile command. Defaults to {@link DEFAULT_FRAMEWORK_CONFIG}.workspace.compileCommandTimeoutMs. */
  timeoutMs?: number;
}
```

Add the function after `runSetupCommand` (after line 148):

```typescript
/**
 * Runs the eval's compile_command in the workspace AFTER the agent finishes and
 * captures the outcome. Unlike runSetupCommand, this never throws — a failed
 * compile is a valid graded result, not an infrastructure error.
 *
 * Splits on `&&` and runs each sub-command in sequence (same argv tokenisation
 * as runSetupCommand). Short-circuits on the first failing sub-command. `ok` is
 * true only if every sub-command exits 0. Output (stdout+stderr) is captured.
 */
export function runCompileCommand(
  workspace: string,
  command: string,
  options?: RunCompileCommandOptions,
): CompileResult {
  const timeout = options?.timeoutMs ?? DEFAULT_FRAMEWORK_CONFIG.workspace.compileCommandTimeoutMs!;
  const base: CompileResult = { ok: false, exitCode: null, signal: null, output: '', command };

  if (!command.trim()) {
    return { ...base, output: 'compile command is empty' };
  }

  const subCommands = command.split('&&').map((s) => s.trim());
  if (subCommands.some((s) => !s)) {
    return { ...base, output: `compile command has an empty segment: ${command}` };
  }

  let combinedOutput = '';
  for (const subCommand of subCommands) {
    logger.info(`  [Compile] Running: ${subCommand}`);
    const args = subCommand.split(/\s+/);
    const cmd = args.shift()!;
    const result = spawnSync(cmd, args, { cwd: workspace, encoding: 'utf-8', timeout });

    combinedOutput += (result.stdout ?? '') + (result.stderr ?? '');

    if (result.error) {
      // ENOENT (command not found) or timeout surfaces here.
      const signal = result.signal ?? null;
      return {
        ok: false,
        exitCode: null,
        signal,
        output: combinedOutput + `\n${result.error.message}`,
        command,
      };
    }
    if (result.signal) {
      return { ok: false, exitCode: null, signal: result.signal, output: combinedOutput, command };
    }
    if (result.status !== 0) {
      return { ok: false, exitCode: result.status, signal: null, output: combinedOutput, command };
    }
  }

  return { ok: true, exitCode: 0, signal: null, output: combinedOutput, command };
}
```

- [ ] **Step 5: Export the helper**

In `packages/eval-core/src/workspace/index.ts`, add `runCompileCommand` to the value export block (after `runSetupCommand,`) and `RunCompileCommandOptions` to the type export line:

```typescript
export {
  setupWorkspace,
  runSetupCommand,
  runCompileCommand,
  cleanupWorkspace,
  writeAgentGuidance,
  AGENT_GUIDANCE,
  AGENT_CONTEXT_FILENAMES,
} from './workspace.js';
export type { SetupWorkspaceOptions, RunSetupCommandOptions, RunCompileCommandOptions } from './workspace.js';
```

In `packages/eval-core/src/index.ts`, add `runCompileCommand` to the workspace value export block (after `runSetupCommand,`, line 80) and `RunCompileCommandOptions` to the workspace type export line (line 91):

```typescript
export type { SetupWorkspaceOptions, RunSetupCommandOptions, RunCompileCommandOptions, CollectFilesOptions } from './workspace/index.js';
```

Also re-export the `CompileResult` type so the orchestration package can import it from `@a0/eval-core`. Add it to the grader-engine type export line (line 153):

```typescript
export type { GraderContext, GraderExecutor } from './graders/index.js';
export type { CompileResult } from '@a0/eval-graders';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test --workspace=@a0/eval-core -- workspace-commands`
Expected: PASS (all `runCompileCommand` cases green).

- [ ] **Step 7: Build the package to confirm exports resolve**

Run: `npm run build --workspace=@a0/eval-core`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/eval-core/src/config/framework.ts packages/eval-core/src/config/defaults.ts packages/eval-core/src/workspace/workspace.ts packages/eval-core/src/workspace/index.ts packages/eval-core/src/index.ts packages/eval-core/tests/workspace-commands.test.ts
git commit -m "feat(core): add non-throwing runCompileCommand workspace helper"
```

---

## Task 7: Wire compile into the host orchestration path

**Files:**
- Modify: `packages/eval/src/cli/run.ts`

- [ ] **Step 1: Import the helper**

In `packages/eval/src/cli/run.ts`, the agent path already dynamically imports workspace helpers at line 129:

```typescript
const { setupWorkspace, runSetupCommand, cleanupWorkspace, writeAgentGuidance } = await import('@a0/eval-core');
```

Add `runCompileCommand` to that destructure:

```typescript
const { setupWorkspace, runSetupCommand, runCompileCommand, cleanupWorkspace, writeAgentGuidance } = await import('@a0/eval-core');
```

- [ ] **Step 2: Run the compile between `runner.run` and `runGraders`**

In `run.ts`, locate the local-execution block. After the `runner.run` call (line 162) and before the `let graderResults` block (line 164), insert:

```typescript
    const compileResult =
      evalDef.compileCommand !== undefined ? runCompileCommand(workspace, evalDef.compileCommand) : undefined;

```

- [ ] **Step 3: Pass it to `runGraders`**

Update the `runGraders` call (lines 167-175) to pass `compileResult` as the 8th argument, after `record.toolCalls`:

```typescript
      graderResults = await runGraders(
        evalDef.graders,
        workspace,
        apiKey,
        undefined,
        agentLevels,
        true,
        record.toolCalls,
        compileResult,
      );
```

- [ ] **Step 4: Build to verify wiring compiles**

Run: `npm run build --workspace=@a0/eval`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/cli/run.ts
git commit -m "feat(eval): run compile_command post-agent on the host path"
```

---

## Task 8: Wire compile into the container orchestration path

**Files:**
- Modify: `packages/eval/src/cli/sandbox-runner.ts`

- [ ] **Step 1: Import the helper**

In `packages/eval/src/cli/sandbox-runner.ts`, add `runCompileCommand` to the `@a0/eval-core` import block (the block spanning lines 17-31, which already imports `runSetupCommand`):

```typescript
  runSetupCommand,
  runCompileCommand,
```

- [ ] **Step 2: Run the compile between `runner.run` and `runGraders`**

After the `runner.run` call (line 109) and before the `let graderResults` block (line 111), insert:

```typescript
    const compileResult =
      evalDef.compileCommand !== undefined ? runCompileCommand(workspace, evalDef.compileCommand) : undefined;

```

- [ ] **Step 3: Pass it to `runGraders`**

Update the `runGraders` call (lines 114-122) to pass `compileResult` as the 8th argument, after `record.toolCalls`:

```typescript
      graderResults = await runGraders(
        evalDef.graders,
        workspace,
        apiKey,
        undefined,
        agentLevels,
        true,
        record.toolCalls,
        compileResult,
      );
```

- [ ] **Step 4: Build to verify wiring compiles**

Run: `npm run build --workspace=@a0/eval`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/cli/sandbox-runner.ts
git commit -m "feat(eval): run compile_command post-agent in the sandbox path"
```

---

## Task 9: Enable `compiles()` in frontend quickstart graders

**Files:**
- Modify: `apps/auth0-evals/src/evals/quickstarts/react/graders.ts`
- Modify: `apps/auth0-evals/src/evals/quickstarts/vue/graders.ts`
- Modify: `apps/auth0-evals/src/evals/quickstarts/angular/graders.ts`
- Modify: `apps/auth0-evals/src/evals/quickstarts/spa-js/graders.ts`
- Modify: `apps/auth0-evals/src/evals/quickstarts/nextjs/graders.ts`
- Modify: `apps/auth0-evals/src/evals/quickstarts/nuxt/graders.ts`

- [ ] **Step 1: Confirm each file's current compile-grader state**

Run: `grep -n "ranCommand\|build\|compiles\|from '@a0/eval-graders'" apps/auth0-evals/src/evals/quickstarts/{react,vue,angular,spa-js,nextjs,nuxt}/graders.ts`
Expected: each shows a commented `ranCommand(...'build'...)` line and an import from `@a0/eval-graders`.

- [ ] **Step 2: For `react/graders.ts`, add `compiles` to the import and replace the commented build line**

Change the import on line 1 from:

```typescript
import { contains, notContains, matches, judge, GraderLevel } from '@a0/eval-graders';
```

to:

```typescript
import { contains, notContains, matches, judge, compiles, GraderLevel } from '@a0/eval-graders';
```

Replace the two commented lines (25-26):

```typescript
    // Event-based install/build verification temporarily disabled — see PR scoping discussion.
    // ranCommand('npm install', '@auth0/auth0-react', 'Ran npm install for @auth0/auth0-react', GraderLevel.L4),
    // ranCommand('npm run', 'build', 'Ran build to verify compilation', GraderLevel.L4),
```

with:

```typescript
    compiles('Project compiles (npm run build succeeds)', GraderLevel.L4),
```

- [ ] **Step 3: Repeat for vue, angular, spa-js, nextjs, nuxt**

For each of `vue`, `angular`, `spa-js`, `nextjs`, `nuxt`:
1. Add `compiles` to the `@a0/eval-graders` import (place it before `GraderLevel`, matching the react edit). If the import does not already use named braces, match the file's existing import style.
2. Remove the commented `ranCommand(...'build'...)` line(s).
3. Insert one `compiles('Project compiles (build succeeds)', GraderLevel.L4),` line in the L4 section (where the commented build grader was).

Use a per-file edit; do NOT bulk-replace, since import lines differ. After each edit, confirm with:
Run: `grep -n "compiles" apps/auth0-evals/src/evals/quickstarts/<name>/graders.ts`
Expected: one `compiles(...)` line, no remaining `ranCommand` build comment.

- [ ] **Step 4: Verify these graders load**

Run: `npm run build --workspace=@a0/eval-core && npm run lint`
Expected: PASS (graders.ts files type-check and lint clean).

- [ ] **Step 5: Commit**

```bash
git add apps/auth0-evals/src/evals/quickstarts/react/graders.ts apps/auth0-evals/src/evals/quickstarts/vue/graders.ts apps/auth0-evals/src/evals/quickstarts/angular/graders.ts apps/auth0-evals/src/evals/quickstarts/spa-js/graders.ts apps/auth0-evals/src/evals/quickstarts/nextjs/graders.ts apps/auth0-evals/src/evals/quickstarts/nuxt/graders.ts
git commit -m "test: enable compiles() grader for frontend quickstarts"
```

---

## Task 10: Documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/ADDING_EVALS.md`

- [ ] **Step 1: Update the grader-primitives table in AGENTS.md**

In `AGENTS.md`, find the "Grader primitives" table (rows for `contains`, `ranCommand`, `wroteFile`, etc.). Add a row:

```
| `compiles(description, level)` | Framework runs the eval's `compile_command` against the workspace after the agent finishes and passes/fails on its exit code — event-style, level required (L4 or L5). Decoupled from whether the agent ran the build itself. |
```

- [ ] **Step 2: Add a note distinguishing compile grading from `ranCommand`**

In `AGENTS.md`, near the grader-levels or grader-primitives section, add:

```
Use `compiles(...)` (not `ranCommand(...build...)`) to grade compilation. `ranCommand` checks whether the *agent* ran a build in its trace; `compiles` runs `compile_command` itself after the agent finishes, so an agent whose output compiles passes even if it never ran the build.
```

- [ ] **Step 3: Update the `compile_command` section in docs/ADDING_EVALS.md**

In `docs/ADDING_EVALS.md`, find the `compile_command` frontmatter description. Update it to state both effects:

```
`compile_command` is used two ways: (1) it is injected into the agent's context file as guidance ("you MUST run this to verify your integration compiles"), and (2) the framework runs it against the workspace after the agent finishes and uses the result to drive any `compiles()` grader in graders.ts. Declare it for evals with a CLI compile step; omit it for evals with none (e.g. mobile). If you add a `compiles()` grader, you MUST also declare `compile_command`, or the grader fails.
```

- [ ] **Step 4: Verify docs reference no stale behaviour**

Run: `grep -n "ranCommand" AGENTS.md docs/ADDING_EVALS.md`
Expected: any remaining `ranCommand` references describe `ranCommand` itself (not compilation specifically). If a line presents `ranCommand` as the compile-grading mechanism, update it to point at `compiles()`.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/ADDING_EVALS.md
git commit -m "docs: document compiles() grader and post-run compile behaviour"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Build the whole project**

Run: `npm run build`
Expected: PASS — all packages compile.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all Vitest suites green, including the new compile tests.

- [ ] **Step 3: Lint and format**

Run: `npm run lint && npm run format`
Expected: PASS / no diffs introduced beyond intended changes.

- [ ] **Step 4: Sanity-run one frontend eval end-to-end (optional, requires .env + Docker or --dangerously-skip-sandbox)**

Run: `npm run evals -- --eval react_quickstart --mode agent --agent-type claude-code --keep-workspace`
Expected: completes; the results JSON contains a passing/failing `compile`-kind grader entry, and `[Compile] Running:` appears in logs.

- [ ] **Step 5: Final commit if any lint/format changes**

```bash
git add -A
git commit -m "chore: lint/format for compile grader feature"
```
