# auth0-evals

The Auth0 eval suite — a collection of evaluation tasks that measure how well LLM agents integrate Auth0 SDKs. Built on the [`@a0/evals`](../../packages/evals/) framework.

## Setup

All commands below are run from the **monorepo root**.

```bash
npm install
npm run build

cp apps/auth0-evals/.env.example apps/auth0-evals/.env
# Add your LLM proxy API key to apps/auth0-evals/.env
```

## Running evals

```bash
# Single eval, baseline mode (default)
npm run run -- --eval react_quickstart --mode baseline

# Agent mode with skills
npm run run -- --eval react_quickstart --mode agent --tools skills

# Agent mode with MCP + skills
npm run run -- --eval react_quickstart --mode agent --tools mcp,skills

# Generate HTML report (auto-discovers scores-*.json)
npm run report
```

See [`@a0/evals` CLI docs](../../packages/evals/) for the full list of flags and options.

## Available evals

| ID | Category | Description |
|----|----------|-------------|
| `react_quickstart` | quickstarts | Add Auth0 login to a React SPA using `@auth0/auth0-react` |
| `nextjs_quickstart` | quickstarts | Add Auth0 login to a Next.js App Router app using `@auth0/nextjs-auth0` |
| `vue_quickstart` | quickstarts | Add Auth0 login to a Vue 3 SPA using `@auth0/auth0-vue` |
| `nuxt_quickstart` | quickstarts | Add Auth0 login to a Nuxt app using `@auth0/auth0-nuxt` |
| `angular_quickstart` | quickstarts | Add Auth0 login to an Angular app using `@auth0/auth0-angular` |
| `spa_js_quickstart` | quickstarts | Add Auth0 login using `@auth0/auth0-spa-js` directly |
| `swift_quickstart` | quickstarts | Add Auth0 login to a Swift iOS app using `Auth0.swift` |
| `android_quickstart` | quickstarts | Add Auth0 login to an Android app using `Auth0.Android` |
| `express_quickstart` | quickstarts | Add Auth0 login to an Express web app using `express-openid-connect` |
| `express_api_quickstart` | quickstarts | Protect an Express API using `express-oauth2-jwt-bearer` |
| `fastapi_quickstart` | quickstarts | Protect a FastAPI API using `auth0-fastapi-api` |
| `fastify_api_quickstart` | quickstarts | Protect a Fastify API using `@auth0/auth0-fastify-api` |
| `flask_quickstart` | quickstarts | Add Auth0 login to a Flask web app |

## Configuration

The framework is configured via `eval.config.js` in this directory. Key settings:

```js
export default {
  evalsDir: 'src/evals',

  proxy: { baseUrl: 'https://your-llm-proxy.example.com/v1' },

  mcp: {
    servers: {
      'auth0-docs': { type: 'http', url: 'https://auth0.com/docs/mcp' },
    },
  },

  skills: {
    remoteRepos: [{
      url: 'https://github.com/auth0/agent-skills.git',
      localPath: 'skills-remote/auth0-skills',
      skillsPath: 'plugins/auth0/skills',
    }],
    localDirs: ['skills'],
  },

  judge: { model: 'claude-sonnet-4-5' },

  models: {
    known: [
      'gpt-5.4', 'gpt-5.4-mini',
      'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-haiku-4-5',
      'gemini-3.1-pro-preview', 'gemini-3.5-flash',
    ],
    default: 'gpt-5.4',
  },

  // Per-runner proxy overrides
  agents: {
    'claude-code': { proxy: { baseUrl: 'https://your-claude-proxy.example.com' } },
    'gemini-cli': { proxy: { baseUrl: 'https://your-gemini-proxy.example.com' } },
  },
};
```

See the [`@a0/evals` configuration reference](../../packages/evals/#configuration) for all available options.

## Eval structure

Each eval lives in `src/evals/<category>/<short-name>/` and contains:

```
src/evals/quickstarts/react/
├── PROMPT.md      # Task description + frontmatter (declares the snake_case id)
├── graders.ts     # Acceptance criteria
└── scaffold/      # Optional starter files seeded into the workspace
```

The directory name is a short kebab-case name (e.g. `react`), while the `id` in `PROMPT.md` frontmatter is snake_case (e.g. `react_quickstart`). The framework uses the frontmatter `id` for `--eval` matching.

### PROMPT.md

The task the LLM must complete. Frontmatter declares metadata:

```yaml
---
id: react_quickstart
name: React Quickstart
skills: auth0-react
setup_command: npm install
---
```

- `id` (required) — snake_case identifier, used with `--eval`
- `name` — human-readable name
- `skills` — comma-separated skill names for `agent+skills` mode
- `setup_command` — run in the workspace before the agent starts

### graders.ts

Exports a `defineGraders()` function returning an array of grader checks:

```typescript
import { contains, notContains, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // L1: Required SDK patterns are present
    contains('@auth0/auth0-react', 'Uses correct SDK', GraderLevel.L1),
    contains('Auth0Provider', 'Wraps app with Auth0Provider', GraderLevel.L1),

    // L2: Hallucinated packages are absent
    notContains('@auth0/react', 'No hallucinated package name', GraderLevel.L2),

    // L3: No security anti-patterns
    notContains('localStorage.setItem', 'No tokens in localStorage', GraderLevel.L3),

    // L4: Structural correctness
    matches(String.raw`<Auth0Provider[\s\S]*?domain`, 'Provider has domain prop', GraderLevel.L4),

    // L5: Uses current API, not deprecated patterns
    contains('authorizationParams', 'Uses authorizationParams', GraderLevel.L5),

    // Holistic judge (no level — always runs)
    judge('Does the solution correctly integrate Auth0 with login, logout, and profile display?', 'react'),
  ];
}
```

### Grader primitives

| Primitive | What it checks |
|-----------|---------------|
| `contains(needle, description, level)` | Substring present in any workspace file |
| `notContains(needle, description, level)` | Substring absent from all workspace files |
| `notContainsInSource(needle, description, level)` | Substring absent from source files (allowed in config) |
| `matches(pattern, description, level)` | Regex match in any workspace file |
| `judge(question, framework?, level?)` | LLM-as-judge yes/no question |

### Grader levels

See the [grader levels reference](../../packages/evals/#grader-levels) in the `@a0/evals` docs for the full table of levels (L1–L5) and which configurations they run in.

Ideally, evals end with a holistic `judge` (no level) that always runs. Some existing evals use levelled judges instead — see each eval's `graders.ts`.

## Adding an eval

1. Create `src/evals/<category>/<short-name>/PROMPT.md` and `graders.ts`
2. Add `id` to `PROMPT.md` frontmatter — the framework auto-discovers evals
3. Assign a `GraderLevel` to every grader; consider ending with a holistic `judge` (no level)
4. Optionally add `scaffold/` files and declare `skills` in frontmatter
5. `npm run build && npm test`

For the full guide, see [docs/ADDING_EVALS.md](../../docs/ADDING_EVALS.md).

## Skills

In `agent+skills` mode, `SKILL.md` files are resolved from:

1. **Local directories** (`skills/`) — takes precedence
2. **Remote repos** — cloned from GitHub on first run

Each eval declares needed skills in its `PROMPT.md` frontmatter:

```yaml
skills: auth0-react
```

Multiple skills can be comma-separated: `skills: auth0-react, auth0-nextjs`.

See [docs/TESTING_SKILLS.md](../../docs/TESTING_SKILLS.md) for local skill development.
