# Adding Evaluations

This guide walks through adding a new evaluation to `auth0-evals`.

---

## 1. Create the Folder Structure

Pick a short, kebab-case directory name and create a folder under `src/evals/<category>/<eval-dir>/` (relative to the `apps/auth0-evals/` app root). The category groups related evals (e.g., `quickstarts`, `api`, `mfa`). Note that the on-disk directory name (e.g. `my-new-eval`) is separate from the snake_case config ID (e.g. `my_new_eval`) you'll declare as `id` in `PROMPT.md` frontmatter and use with `--eval`.

```
apps/auth0-evals/src/evals/
└── quickstarts/
    └── my-new-eval/
        ├── PROMPT.md      # required
        ├── graders.ts     # required
        └── scaffold/      # optional – starter files copied into the agent workspace
```

---

## 2. Write `PROMPT.md`

`PROMPT.md` describes the task. It supports an optional YAML frontmatter block and up to two named sections.

### Frontmatter

```yaml
---
id: my_new_eval
name: My New Eval
skills: auth0-react
setup_command: npm install
compile_command: npm run build
---
```

| Field | Required | Description |
|---|---|---|
| `id` | **yes** | Unique snake_case identifier, used with `--eval` on the CLI |
| `name` | no | Human-readable display name. Defaults to `id` |
| `category` | no | Defaults to the parent directory name (e.g. `quickstarts`) |
| `skills` | no | Comma-separated skill names from [auth0/agent-skills](https://github.com/auth0/agent-skills). Injected into agent context when running with `--tools skills` |
| `setup_command` | no | Command run before the agent starts (e.g. `npm install`). Split on whitespace and executed directly via `spawnSync` — no shell, no operators (`&&`, `\|`, etc.), no quoting. One command only. |
| `compile_command` | no | Compile/build command (e.g. `npm run build`, `node --check server.js`, `.venv/bin/python -m py_compile main.py`). Used two ways: (1) an instruction pointing the agent at this command is appended to the agent's native context file (`CLAUDE.md` / `GEMINI.md` / `AGENTS.md` / `.github/copilot-instructions.md`) alongside the "no docs files" guidance, nudging the agent to verify the build; and (2) **the framework runs it against the workspace after the agent finishes and uses the result to drive any `compiles()` grader in `graders.ts`** — so an agent whose output compiles passes even if it never ran the build itself. Agent modes only — baseline ignores it. Omit for evals with no CLI compile step (e.g. mobile). If you add a `compiles()` grader, you MUST also declare `compile_command`, or the grader fails. |

To test a skill before it is pushed to the remote repo, see [TESTING_SKILLS.md](TESTING_SKILLS.md).

### Sections

| Section | Used in | Purpose |
|---|---|---|
| `## System` | `baseline` | System prompt for the single-turn LLM call. If omitted, a default prompt is used. |
| `## Task` | all modes | The user-facing request sent to the model |

If no sections are present, the entire body (after frontmatter) is used as the task prompt in all modes.

### Example

````markdown
---
id: react_quickstart
name: React Quickstart
skills: auth0-react
setup_command: npm install
compile_command: npm run build
---

## Task
Add Auth0 authentication to a React application using the `@auth0/auth0-react` SDK.

- Domain: `dev-barkbook.us.auth0.com`
- Client ID: `barkbook_client_abc123xyz`

The app should support login, logout, and display the authenticated user's name and email.
````

### Tips

- Do not specify the SDK package name or version in the prompt — the eval should measure whether the model picks the right one.
- Use fake but realistic credentials so graders can detect hardcoding.
- Include negative constraints if a hallucinated package is a known failure mode (e.g., "do not use `@auth0/nextjs-sdk`").

---

## 3. Implement `graders.ts`

Graders define the acceptance criteria. Export a single `defineGraders()` function returning an array of grader objects.

### Grader Primitives

| Primitive | Passes when… |
|---|---|
| `contains(needle, description?, level?, options?)` | Any workspace file contains the substring (case-sensitive by default) |
| `notContains(needle, description?, level?, options?)` | No workspace file contains the substring (case-sensitive by default) |
| `notContainsInSource(needle, description?, level?, options?)` | No **source** file contains the substring (skips `.env`, `.json`, `.plist`, config files) |
| `matches(pattern, description?, level?)` | Any workspace file matches the regex pattern |
| `judge(question, level?)` | An LLM judge answers "yes" given the full workspace contents |
| `ranCommand(command, args, description, level)` | Agent ran a successful shell command containing `command` and all `args` substrings |
| `ranCommandOneOf(commands, description, level)` | Agent ran at least one successful command from the list (substring match) |
| `wroteFile(path, description, level, expected?)` | Agent wrote a file whose path contains the substring. With optional `expected` (string or string array), the combined content of all writes to that path must also contain every `expected` substring |
| `compiles(description, level)` | Framework runs the eval's `compile_command` against the workspace after the agent finishes and passes/fails on its exit code. Requires `compile_command` in frontmatter, or the grader fails. |

The `options` parameter is an object with an optional `caseSensitive` field (defaults to `true`).

The event-based primitives (`ranCommand`, `ranCommandOneOf`, `wroteFile`) inspect the agent's tool-call trace rather than workspace file contents. They only produce meaningful results in agent mode — in baseline mode (no tool calls), they gracefully fail. The `level` parameter is **required** and must be `GraderLevel.L4` or `GraderLevel.L5` (the type system enforces this). Use L4 for behavioral checks like verifying the agent explicitly installed dependencies. To grade compilation, prefer `compiles()` over `ranCommand(...build...)`: `ranCommand` only checks whether the agent ran a build in its trace, whereas `compiles()` runs the eval's `compile_command` itself after the agent finishes, so output that compiles passes even if the agent never ran the build.

The optional `expected` argument on `wroteFile` is useful when a file is excluded from the LLM judge's view (e.g. `.env` / `.env.local`) but you still need to verify the agent wrote the expected variables into it. Because it concatenates content across all writes to the path, it tolerates agents that build the file incrementally.

---

### Grader Levels (L1–L5)

Every grader should be assigned a `GraderLevel` that describes **what kind of correctness it tests**. This lets the framework filter, weight, and report graders by category.

```typescript
import { GraderLevel } from '@a0/eval-graders';
```

---

#### L1 — Positive Presence

**What it tests:** The required SDK imports, function calls, components, and configuration keys are present in the output.

**Intent:** Verify the agent used the right library and invoked the right API surface. These are the minimum requirements for a working integration — if any L1 grader fails, the output is almost certainly broken.

**Primitives to use:** `contains`

**Examples:**
```typescript
contains('@auth0/auth0-react', 'Uses @auth0/auth0-react SDK', GraderLevel.L1),
contains('Auth0Provider', 'Wraps app with Auth0Provider', GraderLevel.L1),
contains('useAuth0', 'Uses useAuth0 hook', GraderLevel.L1),
contains('loginWithRedirect', 'Implements loginWithRedirect', GraderLevel.L1),
contains('webAuth()', 'Uses webAuth() for login', GraderLevel.L1),
```

---

#### L2 — Hallucination / Anti-pattern Detection

**What it tests:** The output does NOT contain hallucinated package names, deprecated APIs, wrong SDK variants, or patterns that are never correct for this task.

**Intent:** Catch the most common model failure mode — confidently using a package or method that doesn't exist or is wrong for the context (e.g., using the server SDK in an SPA, using a CocoaPods import when SPM is required). L2 failures signal the model is making things up.

**Primitives to use:** `notContains`

**Examples:**
```typescript
notContains('@auth0/react', 'No hallucinated @auth0/react package (correct: @auth0/auth0-react)', GraderLevel.L2),
notContains('@auth0/nextjs-auth0', 'Does not use server SDK in a SPA', GraderLevel.L2),
notContains('client_secret', 'No client_secret in SPA (public client)', GraderLevel.L2),
notContains('pod ', 'Does not use CocoaPods (SPM preferred)', GraderLevel.L2),
notContains('completionHandler', 'Does not use deprecated completion handler pattern', GraderLevel.L2),
```

---

#### L3 — Security

**What it tests:** The output does not contain security vulnerabilities — hardcoded credentials in source code, tokens in insecure storage, or sensitive values exposed in the wrong place.

**Intent:** Flag outputs that would pass functional review but introduce real security risks in production. Use `notContainsInSource` (not `notContains`) when the value is legitimately allowed in config files (e.g., a client ID is fine in `Auth0.plist` but not in Swift source). Use `notContains` when the value must never appear anywhere (e.g., a client secret in an SPA).

**Primitives to use:** `notContains`, `notContainsInSource`

**Examples:**
```typescript
// Source-only: domain/clientId are ok in Auth0.plist, not in .swift files
notContainsInSource('barkbook_client_abc123xyz', 'No hardcoded client ID in Swift source', GraderLevel.L3),
notContainsInSource('dev-barkbook.us.auth0.com', 'No hardcoded domain in Swift source', GraderLevel.L3),

// Anywhere: these are never acceptable
notContains('localStorage.setItem', 'No tokens stored in localStorage', GraderLevel.L3),
notContains('sessionStorage.setItem', 'No tokens stored in sessionStorage', GraderLevel.L3),
```

---

#### L4 — Structural / Behavioral Correctness

**What it tests:** The code is structured correctly — the right components are composed in the right way, required lifecycle handling is present, and the integration is functionally complete beyond just having the right strings.

**Intent:** Go beyond string presence to check that the code actually works as intended. L4 catches cases where the model imports the right SDK but wires it up incorrectly — e.g., wrapping the wrong subtree with a provider, or skipping loading-state handling. Use `matches` for structural patterns checkable with regex, and `judge` for behavioral correctness that requires semantic understanding.

**Primitives to use:** `matches`, `judge`

**Examples:**
```typescript
// Regex: verifies structural composition, not just presence of two separate strings
matches(String.raw`<Auth0Provider[\s\S]*?domain`, 'Auth0Provider configured with domain prop', GraderLevel.L4),
contains('credentialsManager', 'Uses CredentialsManager for token storage', GraderLevel.L4),

// Judge: behavioral check that needs semantic understanding
judge(
  'Does the code handle the loading state (isLoading) before checking isAuthenticated? ' +
    'A correct implementation should not render auth-dependent UI while isLoading is true.',
  GraderLevel.L4,
),
judge(
  'Does the code properly handle login and logout flows with appropriate error handling? ' +
    'Does it update UI state after successful authentication?',
  GraderLevel.L4,
),
```

---

#### L5 — Version-specific API Correctness

**What it tests:** The output uses the **current** version of the SDK's API — not deprecated patterns, removed options, or pre-breaking-change signatures that older training data would suggest.

**Intent:** Catch version drift — the hardest failure mode to detect with L1–L4. A model may use the right SDK, avoid hallucinations, pass security checks, and wire things up structurally correctly, but still use an API that was valid two years ago but is now deprecated or removed. L5 graders are the most expensive (usually `judge`-based) and should be targeted at known breaking-change boundaries.

**Primitives to use:** `contains`, `matches`, `judge`

**Examples:**
```typescript
// React: authorizationParams was introduced to replace direct audience/scope props
contains('authorizationParams', 'Uses authorizationParams (not deprecated direct props)', GraderLevel.L5),
judge(
  'Does the code use current @auth0/auth0-react patterns? ' +
    'Specifically: isLoading (not the deprecated "loading" property), ' +
    'and audience/scope via authorizationParams (not as direct props on Auth0Provider)?',
  GraderLevel.L5,
),

// Swift: async/await replaced completion handlers in Auth0.swift v2
matches(String.raw`webAuth\(\)\.start\(\)`, 'Uses async/await webAuth().start() syntax', GraderLevel.L5),
judge(
  'Does the code use modern Swift async/await patterns? ' +
    'Specifically: try await webAuth().start(), CredentialsManager, ' +
    'and Auth0.plist for configuration rather than hardcoded strings?',
  GraderLevel.L5,
),
```

---

### Holistic Judge (no level)

In addition to the leveled graders, include **one unlevel `judge` grader** at the end as a holistic pass/fail signal. This grader is not assigned a level and captures overall integration quality — it will always run regardless of any level filtering.

```typescript
// No level — always runs, measures end-to-end correctness
judge(
  'Does the solution correctly integrate Auth0 into a React SPA with Auth0Provider, ' +
    'useAuth0 hook, login, logout, and user profile display?',
),
```

---

### Full Annotated Example

```typescript
import {
  contains,
  notContains,
  notContainsInSource,
  matches,
  judge,
  GraderLevel,
} from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Positive presence (correct SDK and patterns) ──────────────────────
    contains('@auth0/auth0-react', 'Uses @auth0/auth0-react SDK', GraderLevel.L1),
    contains('Auth0Provider', 'Wraps app with Auth0Provider', GraderLevel.L1),
    contains('useAuth0', 'Uses useAuth0 hook', GraderLevel.L1),
    contains('loginWithRedirect', 'Implements loginWithRedirect', GraderLevel.L1),
    contains('logout', 'Implements logout', GraderLevel.L1),

    // ── L2: Hallucination / anti-pattern detection ────────────────────────────
    notContains('@auth0/react', 'No hallucinated @auth0/react package', GraderLevel.L2),
    notContains('@auth0/nextjs-auth0', 'Does not use server SDK in SPA', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in SPA (public client)', GraderLevel.L2),

    // ── L3: Security checks ───────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens in localStorage', GraderLevel.L3),
    notContains('sessionStorage.setItem', 'No tokens in sessionStorage', GraderLevel.L3),
    notContainsInSource('barkbook_client_abc123xyz', 'No hardcoded client ID in source', GraderLevel.L3),

    // ── L4: Structural / behavioral correctness ───────────────────────────────
    matches(String.raw`<Auth0Provider[\s\S]*?domain`, 'Auth0Provider has domain prop', GraderLevel.L4),
    judge(
      'Does the code guard auth-dependent UI behind isLoading check?',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    contains('authorizationParams', 'Uses authorizationParams (not deprecated direct props)', GraderLevel.L5),
    judge(
      'Does the code use current @auth0/auth0-react v2 patterns — ' +
        'isLoading (not "loading"), authorizationParams for audience/scope?',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a React SPA with Auth0Provider, ' +
        'useAuth0 hook, login, logout, and user profile display?',
    ),
  ];
}
```

### Scaffold Files (optional)

If the task needs starter code, add a `scaffold/` directory. Files are copied verbatim into the agent's temporary workspace before the run.

```
scaffold/
└── src/
    ├── App.js
    └── index.js
```

---

## 4. Auto-Discovery

No manual registration step is needed. The framework auto-discovers evals by scanning `evalsDir` for directories containing both `PROMPT.md` and `graders.ts`. The `id` field in `PROMPT.md` frontmatter is used as the eval identifier.

---

## 5. Run and Iterate

```bash
# Run a specific combo
npm run evals -- --eval my_new_eval --mode agent --tools skills

# Run with a specific model
npm run evals -- --eval my_new_eval --model claude-sonnet-4-6 --mode agent

# Keep the temporary workspace after the run for inspection
npm run evals -- --eval my_new_eval --mode agent --keep-workspace
```

### Modes and tools

| Combo | What it tests |
|---|---|
| `baseline` | Single LLM call, no tools; grades extracted code blocks |
| `agent` | Agent with file/shell tools; grades written workspace files |
| `agent --tools mcp` | Same as `agent`, with the Auth0 MCP server available |
| `agent --tools skills` | Same as `agent`, with the `SKILL.md` injected into agent context |
| `agent --tools mcp,skills` | Both skill injection and MCP together |

To run all combos and measure the delta each investment provides, combine `--mode all` with `--tools` for each tool set you want to compare.

---

### Running with GitHub Copilot CLI

Pass `--agent-type copilot` to route the eval through the `copilot` binary. Skills and MCP are both supported.

---

## 6. Before Submitting

- [ ] `PROMPT.md` and `graders.ts` exist in the eval directory
- [ ] `PROMPT.md` frontmatter includes `id` (snake_case config ID)
- [ ] Graders import from `@a0/eval-graders` (not relative paths)
- [ ] Graders are assigned `GraderLevel` values (L1–L5) with at least one holistic `judge` at the end (no level)
- [ ] `npm run build` completes without errors
- [ ] `npm test` passes
- [ ] `npm run lint` passes

```bash
npm run build && npm test && npm run lint
```
