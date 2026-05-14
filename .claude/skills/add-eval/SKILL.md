---
name: add-eval
description: >
  Use this skill whenever the user wants to add, create, or write a new eval (evaluation) in the
  auth0-evals repository. This includes requests like "add an eval for X", "create a new eval",
  "write a grader for Y", "add a test case for the Z SDK", or "extend the eval suite". Use it
  whenever the user mentions eval IDs, graders, PROMPT.md, graders.ts, or wants to measure how
  well an LLM handles an Auth0 SDK integration task. Always use this skill before writing any
  eval files — it contains critical conventions that are easy to get wrong.
---

# Adding a New Eval to auth0-evals

An "eval" is a task + acceptance criteria that measures how accurately an LLM completes an Auth0 SDK integration. Each eval runs in three modes (baseline, agent, agent+skills) and scores across grader levels.

---

## Overview of what you'll create

All paths below are relative to `apps/auth0-evals/`.

```
src/evals/<category>/<eval-dir>/
├── PROMPT.md       ← task description
├── graders.ts      ← acceptance criteria
└── scaffold/       ← starter files pre-loaded into agent workspace
```

Plus a registration entry in `src/config/evaluations.ts`.

---

## Step 1 — Clarify the eval before writing anything

Before writing files, nail down:

- **What SDK / framework?** (e.g., `@auth0/auth0-react`, `express-openid-connect`, `auth0-fastapi-api`)
- **What integration scenario?** (quickstart login flow, API protection, token refresh, etc.)
- **What category?** Use `quickstarts` for SDK getting-started tasks. Add new categories only if clearly distinct.
- **What config ID?** snake_case identifier used with `--eval` and in `evaluations.ts`. e.g. `vue_quickstart`, `fastify_api_quickstart`
- **What directory name?** Short, lowercase/kebab-case name for the on-disk folder. e.g. `vue`, `fastify-api`. This is the `path` leaf in `evaluations.ts` and is **not** the same as the config ID.
- **What scaffold files?** Every eval must include scaffold files. Provide a minimal project structure with `package.json` and placeholder source files — this is required, not optional.

---

## Step 2 — Create PROMPT.md

**File:** `src/evals/<category>/<eval-dir>/PROMPT.md`

```markdown
---
skills: <skill-name>
setup_command: npm install
---

## Task
<The user-facing request, sent to the LLM in all three modes.>
```

### Frontmatter
- `skills`: references the matching entry in the [auth0/agent-skills](https://github.com/auth0/agent-skills) repo. Used only in `agent+skills` mode. Omit if no matching skill exists yet.
- `setup_command`: command to run before the agent starts (e.g. `npm install`). Include when the scaffold has a `package.json` with dependencies.

### Sections (all optional but follow this order if used)
| Section | Used in | Purpose |
|---|---|---|
| `## System` | baseline only | Single-shot LLM system prompt |
| `## Agent System` | agent modes | Usually omitted; the universal prompt in `src/prompts/system_default.md` is used instead |
| `## Task` | all modes | The actual task sent to the model |

If no sections are present, the entire file is treated as the task.

### Writing a good task prompt
- Be explicit about which SDK and version to use.
- Include realistic (but fake) credentials — domain, client ID, audience, etc.
- State negative constraints if relevant ("do not store tokens in localStorage").
- Mention any specific routes, components, or patterns required.
- **Example credentials to use:** `dev-yourapp.us.auth0.com`, `yourapp_client_abc123xyz`, `https://api.yourapp.com`

---

## Step 3 — Create graders.ts

**File:** `src/evals/<category>/<eval-dir>/graders.ts`

### Required structure

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
    // L1, L2, L3, L4, L5 graders here...

    // Final holistic judge — NO level argument
    judge('Does the solution correctly integrate Auth0 into a <framework>?', '<framework>'),
  ];
}
```

**Critical rules:**
- Export exactly one function: `defineGraders()` returning an array.
- Every grader except the last must have a `GraderLevel` argument.
- The final grader must be a `judge` with **no level** — it always runs regardless of filtering.
- Import from the `@a0/eval-graders` package (monorepo workspace package).

### Grader levels

| Level | Constant | Tests |
|---|---|---|
| L1 | `GraderLevel.L1` | **Positive presence** — required SDK symbols, imports, config keys exist |
| L2 | `GraderLevel.L2` | **Hallucination** — wrong packages, nonexistent APIs, deprecated variants are absent |
| L3 | `GraderLevel.L3` | **Security** — no hardcoded credentials, no tokens in insecure storage |
| L4 | `GraderLevel.L4` | **Structural** — code is correctly wired; right components, right lifecycle |
| L5 | `GraderLevel.L5` | **Version correctness** — uses current API, not deprecated patterns |

Cover all five levels in every eval. L1 and L2 are the most important for baseline comparisons.

### Grader primitives

```typescript
// Check any workspace file contains this string (case-insensitive by default)
contains('@auth0/auth0-react', 'Uses @auth0/auth0-react SDK', GraderLevel.L1)

// Optional: case-sensitive matching
contains('Auth0Provider', 'Wraps app with Auth0Provider', GraderLevel.L1, { caseSensitive: true })

// Check no workspace file contains this string
notContains('@auth0/react', 'No hallucinated @auth0/react package', GraderLevel.L2)

// Like notContains, but skips .env, .json, .plist, and config files.
// Use for security checks where the value is allowed in config but not in source code.
notContainsInSource('yourapp_client_abc123xyz', 'No hardcoded client ID in source', GraderLevel.L3)

// Regex match across any workspace file (use String.raw to avoid escaping issues)
matches(String.raw`<Auth0Provider[\s\S]*?domain`, 'Auth0Provider has domain prop', GraderLevel.L4)

// LLM judge answers a semantic yes/no question about the generated code
judge('Does the code handle loading state before checking isAuthenticated?', 'react', GraderLevel.L4)
```

### Judge frameworks

The second argument to `judge` selects a context-aware system prompt:

| Value | Use for |
|---|---|
| `'react'` | React SPA with `@auth0/auth0-react` |
| `'nextjs'` | Next.js App Router with `@auth0/nextjs-auth0` |
| `'ios'` | iOS/Swift with `Auth0.swift` |
| *(omit)* | Generic / any other framework |

Use `judge` sparingly — it's the most expensive primitive. Save it for checks that can't be expressed as string/regex patterns (e.g., "does the code handle errors gracefully?").

### Full graders.ts example (React SPA)

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
    // ── L1: Required symbols present ──────────────────────────────────
    contains('@auth0/auth0-react', 'Uses @auth0/auth0-react SDK', GraderLevel.L1),
    contains('Auth0Provider', 'Wraps app with Auth0Provider', GraderLevel.L1),
    contains('useAuth0', 'Uses useAuth0 hook', GraderLevel.L1),
    contains('loginWithRedirect', 'Has login trigger', GraderLevel.L1),
    contains('logout', 'Has logout trigger', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK ─────────────────────────────────
    notContains('@auth0/react', 'No hallucinated @auth0/react package', GraderLevel.L2),
    notContains('client_secret', 'No client_secret in SPA (public client)', GraderLevel.L2),

    // ── L3: Security ──────────────────────────────────────────────────
    notContains('localStorage.setItem', 'No tokens in localStorage', GraderLevel.L3),
    notContainsInSource('yourapp_client_abc123xyz', 'No hardcoded client ID in source', GraderLevel.L3),

    // ── L4: Structural correctness ────────────────────────────────────
    matches(String.raw`<Auth0Provider[\s\S]*?domain`, 'Auth0Provider configured with domain', GraderLevel.L4),
    judge('Does the code guard against rendering before auth state is known?', 'react', GraderLevel.L4),

    // ── L5: Current API patterns ──────────────────────────────────────
    contains('authorizationParams', 'Uses authorizationParams (v2 API)', GraderLevel.L5),
    notContains('getAccessTokenSilently().then', 'No deprecated promise-chain pattern', GraderLevel.L5),

    // ── Holistic judge (no level — always runs) ───────────────────────
    judge(
      'Does the solution correctly integrate Auth0 into a React SPA with Auth0Provider, ' +
        'useAuth0 hook, login, logout, and user profile display?',
      'react',
    ),
  ];
}
```

### Avoiding common grader mistakes

- **Never use `readFileSync` to load JSON** — use `import data from './data.json'` instead.
- **Use `notContainsInSource` (not `notContains`) for credential checks** — client IDs are allowed in `.env` files; the check should only fail for source code.
- **Don't skip the holistic judge** — without it, there's no summary-level signal in the results.

---

## Step 4 — Register in evaluations.ts

**File:** `src/config/evaluations.ts`

Add an entry to the `EVALUATIONS` array:

```typescript
{
  id: 'vue_quickstart',              // snake_case config ID; used with --eval flag
  name: 'Vue Quickstart',            // human-readable display name
  category: 'quickstarts',           // groups related evals
  path: 'src/evals/quickstarts/vue', // actual directory; short/kebab-case, NOT the same as id
},
```

Note: `id` and the `path` leaf are intentionally different. For example, `id: 'express_api_quickstart'` maps to `path: 'src/evals/quickstarts/express-api'`. Keep `path` short and kebab-case.

---

## Step 5 — Add scaffold files

Scaffold files are copied into the agent's temporary workspace before execution. **Every eval must include scaffold files.** They give the agent a realistic starting point — a real project with correct dependencies already installed — so graders can check integration quality rather than project setup.

```
src/evals/<category>/<eval-dir>/scaffold/
├── package.json
└── src/
    └── App.jsx     ← partial component with TODO comments
```

**Good scaffold patterns:**
- Include minimal project structure: `package.json` with correct deps, entry points.
- Add `// TODO: integrate Auth0 here` comments at the integration point.
- Don't pre-solve the task — the agent should fill in the Auth0 parts.

---

## Step 6 — Verify

```bash
npm run build          # must compile without errors
npm test               # Vitest suite must pass
npm run lint           # no ESLint errors

# Run the new eval to see it in action (use the config ID, e.g. vue_quickstart)
npm run run -- --eval <eval-config-id> --mode baseline
npm run run -- --eval <eval-config-id> --mode agent --keep-workspace
npm run report
```

If the build fails, the most common causes are:
1. Wrong import path — use `from '@a0/eval-graders'`
2. `defineGraders` not exported from `graders.ts`

---

## Checklist

- [ ] `src/evals/<category>/<eval-dir>/PROMPT.md` created
- [ ] `src/evals/<category>/<eval-dir>/graders.ts` created
- [ ] `src/evals/<category>/<eval-dir>/scaffold/` created with at least a `package.json` and placeholder source files
- [ ] Entry added to `src/config/evaluations.ts` with `id` (snake_case config ID) and `path` (points to `src/evals/<category>/<eval-dir>`)
- [ ] Graders import from `@a0/eval-graders`
- [ ] All graders except the final one have a `GraderLevel`
- [ ] Final grader is a `judge` with no level argument
- [ ] No `readFileSync` for JSON — use `import` instead
- [ ] `npm run build && npm test` passes
