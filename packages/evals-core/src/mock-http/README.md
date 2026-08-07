# mock-http — real Auth0 CLI against a mock Management API

This module lets a **file-less CLI eval** run the **real `auth0` CLI binary** while its HTTP calls to the Auth0 Management API are answered by a local, deterministic mock. Nothing about the CLI is faked except the network hop: real command parsing, real request construction, no auth, no network, no live tenant side effects.

## Why HTTP interception (not a fake binary)

The Auth0 CLI has **no** env var or flag to override the Management API base URL, and **no** `--insecure`. It always builds `https://<domain>/api/v2/<path>` from `~/.config/auth0/config.json`. So we intercept at the DNS+TLS layer:

1. **Seed a fake tenant** (`cli-config.ts`) — the CLI config's `default_tenant` is set to `127.0.0.1:<port>` with a dummy token and a far-future expiry, so the CLI targets the mock and skips login.
2. **Serve HTTPS on loopback** (`server.ts`) — an `https` server binds `127.0.0.1:<port>` using a committed leaf cert whose SAN is IP `127.0.0.1`.
3. **Trust the CA** — the mock CA (`docker/mock-ca/mockCA.pem`) is trusted for the run via `SSL_CERT_FILE`, so Go's `net/http` (the CLI) accepts the mock's TLS without touching the system trust store.
4. **Disable telemetry** — `AUTH0_CLI_ANALYTICS=false`.

The server binds a non-privileged port (default 8443) on loopback.

> **Local-only for now.** These evals run only via `--dangerously-skip-sandbox` (with `--workers 1`, since the mock mutates shared `process.env`). The Docker sandbox does not support them yet — the image ships neither the `auth0` CLI nor the mock CA. Docker support is deferred to a follow-up.

## Manifest format

Routes are **data**, not code. An eval ships an `http-routes/` dir with one `<surface>.routes.json` per Management API surface, a `fixtures/<surface>/` dir of response bodies, and an optional `handlers.js`.

```json
{
  "surface": "guardian",
  "routes": [
    { "match": "PUT guardian/factors/otp", "verb": "create", "state": "guardian.otp", "body": "otp-enabled.json" },
    { "match": "GET guardian/factors", "verb": "reflect", "state": "guardian.otp",
      "present": "factors-otp-on.json", "absent": "factors-otp-off.json" }
  ]
}
```

- `match`: `"<METHOD> <path>"`, path written **without** `api/v2/`; `*` = one path segment.
- Verbs: `create`/`set` (mark state → 201 + `body`), `reflect` (state-dependent `present`/`absent` → read-after-write), `static` (always `body`), `handler` (call `handlers.js` export by name).
- `state`: dotted namespaced key, required for `create`/`set`/`reflect`.
- `body`/`present`/`absent`: inline JSON or a fixture filename.

Unmatched writes → `{"ok":true}`; unmatched reads → `{}`.

## State

`reflect` reads markers written by earlier `create`/`set` routes via a filesystem-backed store (`state.ts`) in a per-run dir **outside the graded workspace**, so graders never see it. This gives deterministic read-after-write within one eval run.

## Regenerating the CA / leaf cert

The certs in `docker/mock-ca/` are **test-only** — the CA signs exactly one loopback (`127.0.0.1`) leaf and guards nothing real. To rotate:

```bash
node apps/auth0-evals/scripts/gen-mock-ca.mjs   # needs openssl
```

## Entry points

- `startMockCliForEval(opts)` (`lifecycle.ts`) — the one call the run lifecycle makes: starts the server, seeds CLI config, sets telemetry off, returns a handle with `stop()`.
- `startMockServer(opts)` (`server.ts`) — lower-level; start just the HTTPS server.
- `dispatch(req, config, handlers)` (`engine.ts`) — pure request → `{ status, body }`, used by the server and unit tests.
