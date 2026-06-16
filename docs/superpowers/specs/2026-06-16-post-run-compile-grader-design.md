# Post-run compile grader

## Problem

Today, compilation is graded indirectly. The eval's `compile_command` frontmatter is
injected into the agent's context file as imperative guidance ("you MUST run this command
to verify your integration compiles"). A grader (`ranCommand` / `ranCommandOneOf`) then
inspects the agent's tool-call trace to check whether the agent ran a build command.

This conflates two different things:

1. **Whether the agent chose to compile** (a behavioral signal).
2. **Whether the agent's output actually compiles** (an output-correctness signal).

An agent that ignores our guidance and never runs the build is penalized — even when the
code it produced compiles perfectly. We want to grade the artifact, not the agent's
adherence to guidance (per guiding principle #1: "grade the artifact, not the explanation").

## Goal

Explicitly run the eval's `compile_command` against the workspace **after the agent
finishes** but while the workspace still exists, capture whether it succeeded, and drive a
grader's pass/fail from that captured result. An agent that produces compiling output
passes the compile grader regardless of whether it ran the build itself.

## Design

### Single source of truth

The grader reuses the eval's existing `compile_command` frontmatter — the same string
already injected as agent guidance. There is exactly one command per eval, declared once.

### Agent guidance unchanged

The `compile_command` is still injected into the agent's context file as guidance (current
behavior, `writeAgentGuidance(workspace, agentType, compileCommand)`). The guidance still
nudges good agent behavior; it just no longer *drives the score*. The score now comes from
the framework's own post-run compile.

### Components

#### 1. `CompileResult` type + `compiles()` grader primitive

In `packages/eval-graders/src/types.ts`:

```ts
export interface CompileResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  output: string;
  command: string;
}
```

In `packages/eval-graders/src/primitives.ts`:

```ts
export function compiles(description: string | undefined, level: EventGraderLevel): GraderDef
```

Returns `{ kind: 'compile', name, level }`. No command argument — the command comes from
the eval's `compile_command` frontmatter. `level` is `EventGraderLevel` (L4 or L5), matching
the other agent-only graders; frontend quickstarts use L4 (replacing the currently-commented
`ranCommand(..., 'build', ..., L4)` lines).

#### 2. Threading the result through the grading engine

- Add `compileResult?: CompileResult` to `GraderContext`
  (`packages/eval-core/src/graders/executors/types.ts`), alongside `toolCalls`.
- Add a `compileResult` parameter to `runGraders(...)`
  (`packages/eval-core/src/graders/engine.ts`), after `toolCalls`, placed into the context
  object — same pattern `toolCalls` already uses.
- New `compileExecutor` (`packages/eval-core/src/graders/executors/compile.ts`), registered
  in `engine.ts`:
  - `ctx.compileResult === undefined` → grader **fails** with detail
    `"compile was not run (no compile_command declared)"`. This surfaces a misconfigured
    eval (a `compiles()` grader with no `compile_command`) rather than silently passing.
  - otherwise pass/fail on `ctx.compileResult.ok`; on failure the detail includes the exit
    code and a truncated tail of `output`.

#### 3. Running the compile (orchestration layer, both paths)

New `runCompileCommand(workspace, command, options?): CompileResult` in
`packages/eval-core/src/workspace/workspace.ts`, next to `runSetupCommand`. Same execution
model (`spawnSync`, `&&`-split into sub-commands, whitespace argv tokens, `cwd = workspace`,
configurable timeout) but **non-throwing** — it captures `status`/`signal` and combined
`stdout`+`stderr` into a `CompileResult` instead of throwing, because a failed compile is a
valid graded outcome, not an infrastructure error. Output is captured via `encoding: 'utf-8'`
(not `stdio: 'inherit'`) so it can be stored in the result.

For an `&&` chain, the first failing sub-command short-circuits and its result is returned;
`ok` is true only if every sub-command exits 0.

Wired into both code paths, only when `evalDef.compileCommand` is set, between `runner.run`
and `runGraders`:

- **Host path:** `packages/eval/src/cli/run.ts` `runAgentJob`, between `runner.run`
  (~line 162) and `runGraders` (~line 167).
- **Container path:** `packages/eval/src/cli/sandbox-runner.ts`, between `runner.run`
  (~line 109) and `runGraders` (~line 114).

Both pass the captured `CompileResult` as the new `runGraders` argument. When
`compileCommand` is unset, both pass `undefined` (and any `compiles()` grader fails per §2).

This covers both execution environments the user requires:
- **Sandbox (default):** the container path runs the compile inside Docker, where
  dependencies were installed and the agent worked.
- **Host (`--dangerously-skip-sandbox`):** the host path runs it on the host, like
  `setup_command`.

### Scoring

No scorer changes. A `compiles()` grader at L4 flows through the existing **Correctness**
dimension (which counts L1/L4/L5 and excludes L2/L3), exactly as the old `ranCommand` build
grader would have. No new scoring dimension is introduced.

### Config

Add `compileCommandTimeoutMs` to the workspace config defaults (compiles/builds are slower
than installs — default 300_000 ms / 5 min). `runCompileCommand` falls back to this default
when no timeout option is passed. On timeout the result is `ok: false` with the signal
recorded (not a throw).

## Testing

Per-package Vitest, in the package where the code lives:

- **`eval-graders`:**
  - `compiles()` returns the correct `GraderDef` shape (`kind: 'compile'`, name, level).
  - `compileExecutor`: passes on `compileResult.ok === true`; fails on `ok === false`
    (detail includes exit code / output tail); fails on `compileResult === undefined`.
- **`eval-core`:**
  - `runCompileCommand` returns `ok: true` on exit 0; returns `ok: false` **without
    throwing** on non-zero exit; captures combined output; handles `&&` chains
    (short-circuits on first failure); records signal on timeout.
  - `runGraders` threads `compileResult` into the grader context and the `compile` grader
    reads it.
- **`eval`:**
  - Orchestration runs the compile between `runner.run` and `runGraders` only when
    `compileCommand` is set; passes `undefined` otherwise.

## Documentation

- `AGENTS.md`: add `compiles` to the grader-primitives table; note in grader-levels section
  that compile verification is now a framework-run check, not a trace inspection.
- `docs/ADDING_EVALS.md`: update the `compile_command` section — it now both injects agent
  guidance *and* drives the `compiles()` grader.
- Enable the real `compiles(...)` grader in the frontend quickstart `graders.ts` files
  (React, Vue, Angular, SPA.js, Next.js, Nuxt), replacing the commented `ranCommand` lines.

## Out of scope (YAGNI)

- Baseline mode — no workspace exists, nothing to compile.
- Per-grader custom compile commands — single `compile_command` per eval is sufficient.
- Partial / warning compile states — binary pass/fail on exit code only.
