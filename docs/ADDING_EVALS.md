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

```typescript
import { contains, notContains, matches, judge } from '../../../agent_eval/graders.js';

export function defineGraders() {
  return [
    contains('@auth0/auth0-react'),
    contains('Auth0Provider'),
    contains('useAuth0'),
    contains('loginWithRedirect'),
    contains('logout('),
    contains('isAuthenticated'),
    notContains('barkbook_secret_', 'No hardcoded client secret'),
    notContains('@auth0/nextjs-sdk', 'No hallucinated SDK'),
    matches(String.raw`<Auth0Provider\s+domain=`),
    judge('Does the solution correctly wrap the app with Auth0Provider and expose login/logout?', 'react'),
  ];
}
```

### Grader Primitives

| Primitive | Passes when… |
|---|---|
| `contains(needle, description?)` | Any workspace file contains the substring (case-insensitive) |
| `notContains(needle, description?)` | No workspace file contains the substring (case-insensitive) |
| `matches(pattern, description?)` | Any workspace file matches the regex pattern |
| `judge(question, framework?)` | An LLM judge answers "yes" given the full workspace contents |

For `judge`, the optional `framework` argument selects a context prompt from `prompts/judge/`. Current options: `react`, `nextjs`, `ios`. Omit it for a generic judgment.

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
- [ ] `npm run build` completes without errors
- [ ] `npm test` passes

```bash
npm run build && npm test
```
