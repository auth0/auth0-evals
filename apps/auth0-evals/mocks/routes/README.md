# Mock Auth0 CLI — route manifests

Each file here mocks **one Auth0 API surface** (e.g. Guardian, Token Exchange).
The `mocks/auth0` dispatcher loads every `*.routes.json` in this directory and
per-eval route dirs (via `EVAL_MOCK_ROUTES_DIRS`), processing manifests until one
handles the request. A feature adds its endpoints by dropping **one manifest file
here** — no edit to the dispatcher, so manifests never conflict.

## Manifest contract

A manifest is a JSON file named `<surface>.routes.json` (e.g. `guardian.routes.json`):

```json
{
  "surface": "guardian",
  "routes": [
    { "match": "<METHOD> <path>", "verb": "<verb>", "state": "key", ... }
  ]
}
```

### Route fields

| Field    | Required? | Type   | Meaning                                                               |
| -------- | --------- | ------ | --------------------------------------------------------------------- |
| `match`  | ✓         | string | Route pattern: `"<METHOD> <path>"`, e.g. `"POST factors"` (lowercased) |
| `verb`   | ✓         | string | Response strategy: `create`, `set`, `reflect`, `static`, or `handler` |
| `state`  | for verbs | string | State key (namespaced, e.g. `feature.thing`); **required for** `create`, `set`, `reflect` |
| `body`   | for verbs | any    | Static response body; used by `create`, `set`, `static`               |
| `present` | for verbs | any    | Response when state exists; used by `reflect`                        |
| `absent` | for verbs | any    | Response when state is absent; used by `reflect`                     |
| `handler` | for verbs | string | Name of a handler function to call; **required for** `handler`        |

### Verbs

| Verb      | Behavior                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `create`  | Mark state as set, then respond with `body`                                                             |
| `set`     | Mark state as set, then respond with `body` (alias for `create`)                                        |
| `reflect` | If state exists, respond with `present`; otherwise respond with `absent` (read-after-write simulation)  |
| `static`  | Always respond with `body` (no state tracking)                                                          |
| `handler` | Call a JavaScript handler function (must be exported from a `handlers.js` in the same manifest dir)    |

### Path matching

Paths are normalized before matching:
- Strip scheme + host: `https://tenant.us.auth0.com/api/v2/x` → `api/v2/x`
- Strip leading slash: `/api/v2/x` → `api/v2/x`
- Strip leading `api/v2/`: `api/v2/x` → `x`

So a route `"GET widgets"` matches all of:
- `auth0 api GET widgets`
- `auth0 api GET /widgets`
- `auth0 api GET /api/v2/widgets`
- `auth0 api GET https://tenant.us.auth0.com/api/v2/widgets`

## Statefulness and fixtures

State is stored in `EVAL_MOCK_STATE_DIR` (a per-run temp dir outside the workspace).
For `reflect` verbs that read from files, create a `fixtures/<surface>/` subdirectory
next to your manifest and reference files by relative path in `present`/`absent`/`body`:

```json
{
  "surface": "myapi",
  "routes": [
    {
      "match": "GET configs",
      "verb": "reflect",
      "state": "myapi.config",
      "present": "config.json",
      "absent": []
    }
  ]
}
```

Then create `fixtures/myapi/config.json` with the response content.

## Rules

- **Name by API surface, not by eval** — `guardian.routes.json`, not `mfa-cli.routes.json`. One
  surface may be consumed by several evals.
- **Namespace your state keys** to avoid collisions — `feature.thing_created`, not `created`.
- **Add a route only when an eval needs the response content.** Unmapped routes
  already succeed via the fallthrough (writes → `{"ok":true}`, reads → `{}`); don't pre-populate endpoints nothing tests.
- **Head each manifest with a `// Consumed by:` comment** (in a separate JSON file next to the manifest if JSON doesn't support comments, or inline if using JSONC) listing the evals that rely on it.

## Example

```json
{
  "surface": "example",
  "routes": [
    {
      "match": "GET widgets",
      "verb": "reflect",
      "state": "ex.widget",
      "present": [{ "id": "w1" }],
      "absent": []
    },
    {
      "match": "POST widgets",
      "verb": "create",
      "state": "ex.widget",
      "body": { "id": "w1" }
    }
  ]
}
```

## Handler functions

For complex logic that a route verb can't express (conditional state checks, request-based branching),
use a `handler` verb and provide a `handlers.js` file next to your manifest:

```js
// mocks/routes/handlers.js (or mocks/<surface>.handlers.js)
export default {
  myhandler: ({ method, path, payload, state }) => {
    // method: lowercased HTTP verb (get, post, etc)
    // path: normalized path after stripping scheme/host/api/v2/slash
    // payload: full argv joined for cheap --data matching
    // state: MockState object (has/set/clear methods)
    if (state.has('feature.flag')) return { status: 'enabled' };
    return { status: 'disabled' };
  },
};
```

## Task 6 preview

Future tasks will extend manifests with `mock:new` and `mock:check` verbs for
programmatic state inspection and multi-request assertions.
