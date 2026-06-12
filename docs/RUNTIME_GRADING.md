# Runtime (Playwright) Grading

Some evals verify the agent's output by *running it*: the framework spins up the
built app, drives it with a headless browser (Playwright), performs a real Auth0
login against a dedicated test tenant, and asserts the app reaches a logged-in
state. This is the `runtime` grader kind (tagged L4 — agent configurations only).

## How it works

After the agent finishes and all static/event graders run, the `runtime` grader:

1. Copies the workspace to a throwaway directory and replaces the prompt's fake
   Auth0 values with real test-tenant values (from env). The original workspace
   (with fake values) is what static graders saw and what gets reported.
2. Runs the eval's `serve_command` and waits for `serve_port` to accept connections.
3. Launches headless Chromium and runs the eval's `playwright.ts` script.
4. Tears everything down (server, browser, copy) regardless of outcome.

## Required environment variables

Set these in `apps/auth0-evals/.env` (host) — they are forwarded into the Docker
sandbox automatically:

| Var | Meaning |
|---|---|
| `RUNTIME_AUTH0_DOMAIN` | Test tenant domain (e.g. `your-tenant.us.auth0.com`) |
| `RUNTIME_AUTH0_CLIENT_ID` | Client ID of the test SPA application |
| `RUNTIME_AUTH0_AUDIENCE` | API audience the eval requests a token for |
| `RUNTIME_TEST_USER_EMAIL` | Test user's email |
| `RUNTIME_TEST_USER_PASSWORD` | Test user's password |
| `RUNTIME_TEST_USER_NAME` | Display name the logged-in UI should show |

## One-time test tenant setup

1. Create (or reuse) a dedicated Auth0 **test tenant**. Do not use a production tenant.
2. Create a **Single Page Application**. Note its Client ID.
3. In the app settings, add to **Allowed Callback URLs**, **Allowed Logout URLs**,
   and **Allowed Web Origins**: `http://localhost:5173` (the `serve_port` declared
   by `react_quickstart`). Add other ports here as you add runtime evals on other
   ports.
4. Create an **API** (or reuse one) and note its identifier — that is the audience.
5. Create a **test user** with a known password and set its name to a stable value.
6. Put all six values into `apps/auth0-evals/.env`.

## Operational requirement (important)

The `runtime` grader on `react_quickstart` is **always active** and **hard-fails**
when the `RUNTIME_*` env vars or a browser are missing. Because it is L4, it runs
in **agent** configurations only (baseline is unaffected).

Consequence: **every agent-mode run of `react_quickstart` — including
`/evals-smoke-test` and CI — fails unless the test-tenant creds and a browser are
present.** CI must provide the `RUNTIME_*` values as secrets, and the Docker image
ships Chromium (see `docker/Dockerfile`).

## Adding runtime grading to a new eval

1. Add `serve_command`, `serve_port`, and `runtime_swap` to the eval's PROMPT.md
   frontmatter (see `docs/ADDING_EVALS.md`).
2. Mandate `data-testid`s in the PROMPT.md task text so the script can find UI.
3. Add a `playwright.ts` exporting a default async function
   `({ page, baseURL, testUser }) => Promise<{ passed, detail }>`.
4. Add a `runtime('./playwright.ts', '...')` grader to `graders.ts`.
5. Register the new `serve_port` as an allowed callback URL in the test tenant app.
