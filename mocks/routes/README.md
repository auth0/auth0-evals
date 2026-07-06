# Mock Auth0 CLI — route files

Each file here mocks **one Auth0 API surface** (e.g. Guardian, Token Exchange).
The `mocks/auth0` dispatcher sources every `*.sh` in this directory, in turn,
until one handles the request. A feature adds its endpoints by dropping **one
file here** — no edit to the dispatcher, so route files never conflict.

## Contract

The dispatcher exports these before sourcing a route file:

| Variable  | Meaning                                                        |
| --------- | ------------------------------------------------------------- |
| `ROUTE`   | `"<method> <path>"`, e.g. `put guardian/factors/otp` (matched form) |
| `METHOD`  | Lowercased HTTP method (`get`/`put`/`patch`/`post`/`delete`)  |
| `PATH_`   | Normalized path (scheme/host/`/api/v2/`/leading-slash stripped) |
| `PAYLOAD` | All args joined — cheap matching on the `--data` body         |

Helpers from `mocks/lib.sh` are available: `emit`, `record_state`,
`clear_state`, `has_state`.

To respond, match on `$ROUTE` and call **`emit <body>`** — it prints the body
and marks the request handled (the dispatcher then stops and skips the
fallthrough). If your route file doesn't match, do nothing: the dispatcher tries
the next file, then falls through (unmapped writes → `{"ok":true}`, reads → `{}`).

## Rules

- **Name by API surface, not by eval** — `guardian.sh`, not `mfa-cli.sh`. One
  surface may be consumed by several evals.
- **Namespace your state keys** to avoid collisions — `record_state cte_action_created`,
  not `record_state created`.
- **Add a route only when an eval needs the response content.** Unmapped routes
  already succeed via the fallthrough; don't pre-populate endpoints nothing tests.
- **Head each file with a `# Consumed by:` line** listing the evals that rely on it.

## Example

```sh
# mocks/routes/example.sh
# Auth0 Management API: <surface>.
# Consumed by: <eval_id>, ...
case "$ROUTE" in
  "get widgets")
    if has_state ex_widget; then emit '[{"id":"w1"}]'; else emit '[]'; fi
    ;;
  "post widgets")
    record_state ex_widget
    emit '{"id":"w1"}'
    ;;
esac
```
