# Adding Evaluations

This guide walks through adding a new evaluation to `auth0-evals`.

---

## 1. Create the Folder Structure

Pick a descriptive slug and create a directory under `src/evals/<category>/<eval-id>/`. The category groups related evals (e.g., `quickstarts`, `api`, `mfa`).

```
src/evals/
└── quickstarts/
    └── my-new-eval/
        ├── PROMPT.md      # required
        ├── graders.ts     # required
        └── scaffold/      # optional – starter files copied into the agent workspace
```

---

## 2. Write `PROMPT.md`

`PROMPT.md` describes the task. It supports an optional YAML frontmatter block and up to three named sections.

### Frontmatter (optional)

```yaml
---
skills: auth0-react
---
```

`skills` references entries in the [auth0/agent-skills](https://github.com/auth0/agent-skills) repository. The matching `SKILL.md` is fetched at runtime and prepended to the agent system prompt (`## Agent System`) when running in `agent+skills` mode.

To test a skill before it is pushed to the remote repo, see [TESTING_SKILLS.md](TESTING_SKILLS.md).

### Sections

| Section | Used in | Purpose |
|---|---|---|
| `## System` | `baseline` | System prompt for a single-turn LLM call |
| `## Agent System` | `agent`, `agent+skills` | System prompt for the ReAct agent loop |
| `## Task` | all modes | The user-facing request sent to the model |

If no sections are present, the entire file is used as the task prompt.

### Example

````markdown
---
skills: auth0-react
---

## Agent System
You are an expert React developer operating inside a project workspace with tools available.
You MUST use the provided tools to read and write files. Do NOT output code as prose.

## Task
Add Auth0 authentication to a React application using the `@auth0/auth0-react` SDK.

- Domain: `dev-barkbook.us.auth0.com`
- Client ID: `barkbook_client_abc123xyz`

The app should support login, logout, and display the authenticated user's name and email.
````

### Tips

- Be explicit about the SDK, framework version, and any configuration values (domain, client ID, etc.).
- Use fake but realistic credentials so graders can detect hardcoding.
- Include negative constraints if a hallucinated package is a known failure mode (e.g., "do not use `@auth0/nextjs-sdk`").

---

## 3. Implement `graders.ts`

Graders define the acceptance criteria. Export a single `defineGraders()` function returning an array of grader objects.

### Grader Primitives

| Primitive | Passes when… |
|---|---|
| `contains(needle, description?, level?)` | Any workspace file contains the substring (case-insensitive) |
| `notContains(needle, description?, level?)` | No workspace file contains the substring (case-insensitive) |
| `notContainsInSource(needle, description?, level?)` | No **source** file contains the substring (skips `.env`, `.json`, `.plist`, config files) |
| `matches(pattern, description?, level?)` | Any workspace file matches the regex pattern |
| `judge(question, framework?, level?)` | An LLM judge answers "yes" given the full workspace contents |

For `judge`, the optional `framework` argument selects a context prompt from `prompts/judge/`. Current options: `react`, `nextjs`, `ios`. Omit it for a generic judgment.

---

### Grader Levels (L1–L5)

Every grader should be assigned a `GraderLevel` that describes **what kind of correctness it tests**. This lets the framework filter, weight, and report graders by category.

```typescript
import { GraderLevel } from '../../../agent_eval/graders.js';
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
  'react',
  GraderLevel.L4,
),
judge(
  'Does the code properly handle login and logout flows with appropriate error handling? ' +
    'Does it update UI state after successful authentication?',
  'ios',
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
  'react',
  GraderLevel.L5,
),

// Swift: async/await replaced completion handlers in Auth0.swift v2
matches(String.raw`webAuth\(\)\.start\(\)`, 'Uses async/await webAuth().start() syntax', GraderLevel.L5),
judge(
  'Does the code use modern Swift async/await patterns? ' +
    'Specifically: try await webAuth().start(), CredentialsManager, ' +
    'and Auth0.plist for configuration rather than hardcoded strings?',
  'ios',
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
  'react',
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
} from '../../../agent_eval/graders.js';

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
      'react',
      GraderLevel.L4,
    ),

    // ── L5: Version-specific API correctness ──────────────────────────────────
    contains('authorizationParams', 'Uses authorizationParams (not deprecated direct props)', GraderLevel.L5),
    judge(
      'Does the code use current @auth0/auth0-react v2 patterns — ' +
        'isLoading (not "loading"), authorizationParams for audience/scope?',
      'react',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a React SPA with Auth0Provider, ' +
        'useAuth0 hook, login, logout, and user profile display?',
      'react',
    ),
  ];
}
```

### Scaffold Files (optional)

If the task needs starter code, add a `scaffold/` directory. Files are copied verbatim into the agent's temporary workspace before the run. Use TODO comments to mark what the agent should fill in.

```
scaffold/
└── src/
    ├── App.js      # TODO: wrap with Auth0Provider, add login/logout buttons
    └── index.js
```

---

## 4. Register the Evaluation

Add an entry to `src/config/evaluations.ts`:

```typescript
export const EVALUATIONS: EvalConfig[] = [
  // existing evals …
  {
    id: 'my_new_eval',                           // unique snake_case identifier
    name: 'My New Eval',                         // human-readable display name
    category: 'quickstarts',                     // matches the directory category
    path: 'src/evals/quickstarts/my-new-eval',
  },
];
```

The `id` value is what you pass to `--eval` on the CLI.

---

## 5. Register in `vite.config.ts`

`npm run run` executes `node dist/run.js`, which calls `loadEval()` to dynamically import `dist/<eval-path>/graders.js`. Vite only emits that file if the entry is registered in `vite.config.ts`.

Add a line to the `entry` object:

```typescript
entry: {
  // existing entries …
  'src/evals/quickstarts/my-new-eval/graders': resolve(__dirname, 'src/evals/quickstarts/my-new-eval/graders.ts'),
},
```

The key is the output path relative to `dist/` (no `.js` extension). The value is the source path.

> **Note:** If your `graders.ts` imports a local JSON file (e.g., `graders.json`), use a static `import` rather than `readFileSync`. Vite will bundle the JSON into the compiled output, so no file-copying or path tricks are needed:
> ```typescript
> import gradersData from './graders.json';
> ```

---

## 6. Run and Iterate

```bash
# Run only your eval in all modes with the default model
npm run run -- --eval my_new_eval --mode all

# Run with a specific model
npm run run -- --eval my_new_eval --model claude-4-6-sonnet --mode agent+skills

# Keep the temporary workspace after the run for inspection
npm run run -- --eval my_new_eval --mode agent --keep-workspace
```

### Modes

| Mode | What it tests |
|---|---|
| `baseline` | Single LLM call, no tools; grades extracted code blocks |
| `agent` | ReAct agent with file/shell tools; grades written workspace files |
| `agent+skills` | Same as `agent`, with the fetched `SKILL.md` prepended to the agent system prompt |

Use `--mode all` to compare all three and measure the delta that skills provide.

---

## 7. Before Submitting

- [ ] `PROMPT.md` and `graders.ts` exist in the eval directory
- [ ] The eval is registered in `config/evaluations.ts`
- [ ] The eval entry is added to `vite.config.ts`
- [ ] All grader imports use the `.js` extension (required for ESM)
- [ ] Graders are assigned `GraderLevel` values (L1–L5) with at least one holistic `judge` at the end (no level)
- [ ] `npm run build` completes without errors
- [ ] `npm test` passes

```bash
npm run build && npm test
```
