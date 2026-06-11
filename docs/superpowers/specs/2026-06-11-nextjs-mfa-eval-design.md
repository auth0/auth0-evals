# Next.js MFA Step-Up Eval + Skill Update — Design

Date: 2026-06-11

## Goal

Add an eval that measures whether an LLM agent can correctly add MFA (multi-factor
authentication) step-up to a Next.js App Router app using `@auth0/nextjs-auth0` (v4),
analogous to the existing `react_mfa` eval. Because the Next.js SDK's MFA model differs
fundamentally from the React SDK's, the `auth0-mfa` and `auth0-nextjs` agent-skills also
need updating to describe the correct v4 pattern.

Work spans two repos:

- **auth0-evals** (this repo): new scaffold + new eval.
- **agent-skills** (`~/Development/auth0/agent-skills`): skill content updates on a new branch.

## Background — why the React pattern does not transfer

The existing `react_mfa` eval tests a **proactive** flow: request `acr_values` +
`max_age: 0` inside `authorizationParams`, then read the `amr` claim via
`getIdTokenClaims()` to detect prior MFA completion, gating the action client-side.

The Next.js v4 SDK (verified against v4.22.0) does MFA step-up **reactively**. There is no
proactive "request step-up" API and no server-side `amr`/`acr` claim inspection. Instead:

1. Server calls `auth0.getAccessToken({ audience, refresh: true })` for a protected audience.
2. Auth0 — via a post-login **Action** that enforces MFA for that audience — returns
   `mfa_required`. The SDK throws `MfaRequiredError`.
3. The app catches it and surfaces it to the client (e.g. `return NextResponse.json(error.toJSON(), { status: 403 })`).
4. The client completes MFA, either via full-page redirect (using `error.mfa_token`) or via
   the popup helper `mfa.challengeWithPopup({ audience })` from `@auth0/nextjs-auth0/client`.

Consequently the React graders would be wrong here, and the `auth0-mfa` skill's current
Next.js example (which shows `amr` inspection and a `/api/auth/login?acr_values=...` redirect)
is outdated on two counts: wrong flow, and wrong v3 route prefix.

## The pattern this eval tests (token stays server-side)

Per the requirement that the access token never reaches the browser, the expected solution is:

1. **Server** (route handler or server action) calls
   `auth0.getAccessToken({ audience, refresh: true })` for the high-security audience.
2. On `mfa_required`, the SDK throws `MfaRequiredError`; the server returns
   `error.toJSON()` as a **403**.
3. **Client** component catches the 403, detects `mfa_required`, and calls
   `mfa.challengeWithPopup({ audience })` from `@auth0/nextjs-auth0/client`. The user
   completes MFA in the popup; the SDK caches the stepped-up token **in the server session**.
4. **Client** re-invokes the server route. `getAccessToken` now succeeds server-side, and the
   server uses the token to call the protected API. **The access token never appears in
   client code.**

This is intentionally stricter than the SDK docs' "Basic Usage" example (which calls
`getAccessToken()` client-side and `fetch`es the API with a `Bearer` token in client code).
Keeping the token server-side makes the L3/L4 graders meaningful and is the behavior the
updated skill content should recommend.

### Exact symbols / strings (SDK v4.22.0)

- `@auth0/nextjs-auth0/server` — `Auth0Client`, `MfaRequiredError`, `getAccessToken`
- `@auth0/nextjs-auth0/client` — `mfa`, `getAccessToken`
- `mfa.challengeWithPopup`
- Error code: `mfa_required`
- Default acr policy: `http://schemas.openid.net/pape/policies/2007/06/multi-factor`
  (the SDK supplies this default; the app does **not** hardcode it)
- `MfaRequiredError` shape: `{ error, error_description, mfa_token, mfa_requirements? }`
  via `toJSON()`; `error: "mfa_required"`.

## Section 2 — Scaffold: `scaffolds/nextjs/auth0`

A new reusable scaffold with **login already wired** (v4), mirroring how
`scaffolds/react/auth0` backs the React MFA eval.

```
apps/auth0-evals/src/evals/scaffolds/nextjs/auth0/
  src/lib/auth0.ts            # Auth0Client instance
  src/middleware.ts           # auth0.middleware
  src/app/layout.tsx
  src/app/page.tsx
  src/app/dashboard/page.tsx  # protected page (login already set up)
  package.json                # next 16, @auth0/nextjs-auth0 ^4.22, react 19
  tsconfig.json
  .env.local                  # fake creds (AUTH0_DOMAIN, AUTH0_CLIENT_ID,
                              #   AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL)
```

Fake credentials reuse the project's conventions:
`dev-barkbook.us.auth0.com`, `barkbook_client_abc123xyz`, `barkbook_secret_def456uvw`.

## Section 3 — The eval: `mfa/nextjs`

`PROMPT.md` frontmatter:

```yaml
---
id: nextjs_mfa
name: Next.js MFA Step-Up
scaffold: src/evals/scaffolds/nextjs/auth0
skills: auth0-nextjs,auth0-mfa
setup_command: npm install
---
```

Task framing (parallel to React's "Transfer Funds"): the app already has Auth0 login; add a
Transfer Funds feature that requires MFA step-up before the transfer runs; the access token
must stay server-side (browser never sees it); use a popup so the user isn't redirected away.
Include domain / client id / audience like the other evals.

## Section 4 — Graders (`graders.ts`)

- **L1 (presence):** `@auth0/nextjs-auth0/server`, `@auth0/nextjs-auth0/client`,
  `MfaRequiredError`, `challengeWithPopup`, `getAccessToken`.
- **L2 (hallucination / wrong SDK absent):** `@auth0/auth0-react`, `getAccessTokenSilently`,
  `loginWithRedirect`, `getIdTokenClaims`, `speakeasy`, `otplib`, `@auth0/guardian`;
  no v3 `/api/auth/`.
- **L3 (security):** `notContainsInSource` for the fake creds; a `judge` verifying the access
  token is used server-side and is never returned to or stored in the browser.
- **L4 (structural):** `judge` — server catches `MfaRequiredError` and returns 403; client
  triggers `challengeWithPopup` on `mfa_required`; server (not client) calls the protected API
  with the token.
- **L5 (version):** `judge` — uses the reactive flow (not proactive `acr_values` / `amr`
  inspection), v4 `/auth/` routes, `Auth0Client`.
- **Holistic judge** (no level).

## Section 5 — Skill updates (agent-skills repo, new branch)

Branch off `main` (e.g. `feat/nextjs-mfa-step-up`):

- **`auth0-mfa`** (`plugins/auth0/skills/auth0-mfa/references/examples.md`): replace the
  outdated Next.js section with the v4 reactive, server-held-token flow.
- **`auth0-nextjs`** (`plugins/auth0/skills/auth0-nextjs/`): add a concise MFA step-up
  section / reference pointing to the reactive flow + `challengeWithPopup`.
- Must pass `skillsaw` validation (frontmatter, kebab-case file names, directory structure).

Do not push or open a PR without explicit user approval.

## Section 6 — Live-testing handoff (manual)

After build, run with `--keep-workspace`. Provide the user a checklist:

- Auth0 tenant config: a Regular Web App; a post-login **Action** that challenges MFA when the
  protected audience is requested (without it, `getAccessToken` simply succeeds and step-up
  never triggers); tenant MFA policy = Adaptive or Never; an enrolled factor (e.g. TOTP);
  callback URLs.
- Which `.env.local` vars to fill in with real tenant values.
- Manual click-through steps to verify the popup step-up resolves and the protected action
  runs.

No automated E2E in this effort.

## Out of scope

- Automated Playwright E2E.
- Porting PR #2507's example app into `nextjs-auth0`.
- Pushing / opening PRs in agent-skills.
