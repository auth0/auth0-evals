# @a0/evals-core

Core types, configuration, and utilities for the Auth0 eval framework. This package holds the framework's foundational building blocks — shared type definitions, config loading, eval discovery, and scoring primitives — that `@a0/evals` and `@a0/evals-reporter` build on.

Part of the [`auth0-evals`](https://github.com/auth0/auth0-evals) monorepo.

## What it provides

- **Types** — agent/trace types (`AgentType`, `TraceStep`, `TurnMetricEntry`), job results (`JobResult`, `AgentJobResult`, `BaselineJobResult`), scoring types (`RunRecord`, `DimensionScore`), and eval definitions (`EvalDefinition`, `EvalConfig`).
- **Configuration** — `defineConfig` / `loadConfig` for typed `eval.config.js` files, `DEFAULT_FRAMEWORK_CONFIG`, and `deepMerge`.
- **Eval discovery** — `discoverEvals` and `loadEval` for auto-discovering evals from a directory.
- **Utilities** — `logger` / `setLogger`, `withRetry` / `isTransientLlmError`, `estimateCost`, and MCP auth helpers (`mintMcpToken`, `mcpBearerTokenEnvVar`).

## Usage

```ts
import { defineConfig, discoverEvals } from '@a0/evals-core';
import type { EvalDefinition, JobResult } from '@a0/evals-core';

const config = defineConfig({ evalsDir: 'src/evals' });
const evals = await discoverEvals(config.evalsDir);
```

Most consumers use this package indirectly through [`@a0/evals`](https://www.npmjs.com/package/@a0/evals). See the [monorepo README](https://github.com/auth0/auth0-evals) for the full framework guide.

## License

Apache-2.0 © Okta, Inc. See [LICENSE](https://github.com/auth0/auth0-evals/blob/main/LICENSE).
