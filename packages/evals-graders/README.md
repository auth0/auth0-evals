# @a0/evals-graders

Grader primitives and type definitions for the Auth0 eval framework. A grader is a single pass/fail check run against an eval's output; this package provides the factory functions used to define them in an eval's `graders.ts`.

Part of the [`auth0-evals`](https://github.com/auth0/auth0-evals) monorepo.

## Grader primitives

| Primitive | What it does |
|---|---|
| `contains(needle)` | Substring present in any non-excluded workspace file |
| `notContains(needle)` | Substring must NOT appear in any non-excluded workspace file |
| `notContainsInSource(needle)` | Substring must NOT appear in source files (allowed in config) |
| `matches(pattern)` | Regex match in any non-excluded workspace file |
| `judge(question, framework?)` | LLM-as-judge yes/no question |
| `ranCommand(command, args, description, level)` | Agent ran a shell command containing `command` and all `args` |
| `ranCommandOneOf(commands, description, level)` | Agent ran at least one command from the list |
| `wroteFile(path, description, level, expected?)` | Agent wrote a file whose path contains the substring (optionally asserting content) |
| `compiles(description, level)` | Framework runs the eval's `compile_command` and passes/fails on exit code |
| `calledTool(toolName, description, level)` | Agent invoked an MCP tool whose name contains `toolName` |
| `calledToolOneOf(toolNames, description, level)` | Agent invoked at least one of the named MCP tools |

## Grader levels

`GraderLevel` classifies each grader by what it tests and which configurations it runs in:

| Level | Enum value | Tests |
|---|---|---|
| L1 | `positive_presence` | Required SDK symbols, imports, config keys are present |
| L2 | `hallucination` | Hallucinated packages / wrong SDK variants are absent |
| L3 | `security` | No hardcoded credentials or tokens in insecure storage |
| L4 | `structural` | Code is correctly wired |
| L5 | `version_correctness` | Uses current API, not deprecated patterns |

## Usage

```ts
import { contains, notContainsInSource, judge, GraderLevel } from '@a0/evals-graders';

export const graders = [
  contains('@auth0/auth0-react', 'imports the Auth0 React SDK', GraderLevel.positive_presence),
  notContainsInSource('client_secret', 'no client secret in source', GraderLevel.security),
  // Holistic judge — no level, always runs
  judge('Does the app correctly wrap the root with Auth0Provider?'),
];
```

See the [monorepo README](https://github.com/auth0/auth0-evals) for the full framework guide.

## License

Apache-2.0 © Okta, Inc. See [LICENSE](https://github.com/auth0/auth0-evals/blob/main/LICENSE).
