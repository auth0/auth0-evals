# Next.js MFA Step-Up Eval + Skill Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `nextjs_mfa` eval (scaffold + prompt + graders) that measures whether an agent can implement reactive, server-held-token MFA step-up with `@auth0/nextjs-auth0` v4, and update the `auth0-mfa` and `auth0-nextjs` agent-skills to describe the correct v4 pattern.

**Architecture:** Two repos. In **auth0-evals**: a new reusable scaffold `scaffolds/nextjs/auth0` (v4 login already wired) plus a new eval `mfa/nextjs` (PROMPT.md + graders.ts), auto-discovered by the framework. In **agent-skills** (separate checkout): skill content edits on a new branch — fix the outdated Next.js MFA example in `auth0-mfa` and add an MFA step-up reference to `auth0-nextjs`.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Next.js 16 App Router, `@auth0/nextjs-auth0` ^4.22, `@a0/eval-graders` primitives, Vitest. Skills validated by `skillsaw`.

**Key reference doc:** `docs/superpowers/specs/2026-06-11-nextjs-mfa-eval-design.md` (read it before starting).

---

## Reference facts (verified against nextjs-auth0 v4.22.0)

The expected solution (token stays server-side):

1. **Server** route/action calls `auth0.getAccessToken({ audience, refresh: true })`.
2. On `mfa_required`, SDK throws `MfaRequiredError`; server returns `error.toJSON()` as **403**.
3. **Client** catches the 403, detects `mfa_required`, calls `mfa.challengeWithPopup({ audience })` from `@auth0/nextjs-auth0/client`. SDK caches stepped-up token in the **server session**.
4. **Client** re-invokes the server route; `getAccessToken` succeeds server-side; server calls the protected API. The access token never appears in client code.

Exact symbols / strings:
- `@auth0/nextjs-auth0/server` — `Auth0Client`, `MfaRequiredError`, `getAccessToken`
- `@auth0/nextjs-auth0/client` — `mfa`, `getAccessToken`
- `mfa.challengeWithPopup`
- error code: `mfa_required`
- `MfaRequiredError.toJSON()` → `{ error, error_description, mfa_token, mfa_requirements? }`, `error: "mfa_required"`
- default acr policy `http://schemas.openid.net/pape/policies/2007/06/multi-factor` (SDK default; app does not hardcode)

Wrong patterns that must be ABSENT (React/SPA flow does not transfer):
- `@auth0/auth0-react`, `getAccessTokenSilently`, `loginWithRedirect`, `getIdTokenClaims`, `amr`-claim inspection
- v3 route prefix `/api/auth/`
- server-side TOTP libs: `speakeasy`, `otplib`, fake `@auth0/guardian`

---

## File structure

**auth0-evals (this repo, worktree):**

```
apps/auth0-evals/src/evals/
  scaffolds/nextjs/auth0/           # NEW reusable scaffold (login already wired)
    package.json
    tsconfig.json
    .env.local
    src/lib/auth0.ts
    src/middleware.ts
    src/app/layout.tsx
    src/app/page.tsx
    src/app/dashboard/page.tsx
  mfa/nextjs/                       # NEW eval
    PROMPT.md
    graders.ts
docs/superpowers/handoff/nextjs-mfa-live-test.md   # NEW manual test checklist
```

**agent-skills (~/Development/auth0/agent-skills, separate branch):**

```
plugins/auth0/skills/auth0-mfa/references/examples.md     # MODIFY Next.js section
plugins/auth0/skills/auth0-nextjs/references/mfa.md        # NEW reference
plugins/auth0/skills/auth0-nextjs/SKILL.md                 # MODIFY: link new reference
```

---

## Task 1: Create the Next.js + Auth0 scaffold (login already wired)

**Files:**
- Create: `apps/auth0-evals/src/evals/scaffolds/nextjs/auth0/package.json`
- Create: `apps/auth0-evals/src/evals/scaffolds/nextjs/auth0/tsconfig.json`
- Create: `apps/auth0-evals/src/evals/scaffolds/nextjs/auth0/.env.local`
- Create: `apps/auth0-evals/src/evals/scaffolds/nextjs/auth0/src/lib/auth0.ts`
- Create: `apps/auth0-evals/src/evals/scaffolds/nextjs/auth0/src/middleware.ts`
- Create: `apps/auth0-evals/src/evals/scaffolds/nextjs/auth0/src/app/layout.tsx`
- Create: `apps/auth0-evals/src/evals/scaffolds/nextjs/auth0/src/app/page.tsx`
- Create: `apps/auth0-evals/src/evals/scaffolds/nextjs/auth0/src/app/dashboard/page.tsx`

This scaffold represents "Auth0 login is already set up" — the agent builds the MFA feature on top. It mirrors `scaffolds/react/auth0`. There are no unit tests for scaffold files (they are static fixtures); verification is `npm install` + `next build` in Task 2.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "nextjs-mfa-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@auth0/nextjs-auth0": "^4.22.0",
    "next": "16.2.7",
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`** (copy of the quickstart nextjs scaffold tsconfig)

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "incremental": true,
    "module": "esnext",
    "esModuleInterop": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `.env.local`** (fake creds — same convention as other evals)

```bash
AUTH0_DOMAIN=dev-barkbook.us.auth0.com
AUTH0_CLIENT_ID=barkbook_client_abc123xyz
AUTH0_CLIENT_SECRET=barkbook_secret_def456uvw
AUTH0_SECRET=use-a-long-random-32-byte-value-for-cookie-encryption-000
APP_BASE_URL=http://localhost:3000
```

- [ ] **Step 4: Write `src/lib/auth0.ts`**

```ts
import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const auth0 = new Auth0Client();
```

- [ ] **Step 5: Write `src/middleware.ts`** (lives in `src/` per SDK note; valid on Next 16 Edge)

```ts
import type { NextRequest } from 'next/server';

import { auth0 } from './lib/auth0';

export async function middleware(request: NextRequest) {
  return await auth0.middleware(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
};
```

- [ ] **Step 6: Write `src/app/layout.tsx`**

```tsx
export const metadata = {
  title: 'Barkbook',
  description: 'A social network for dogs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Write `src/app/page.tsx`** (home with login/logout — session-aware)

```tsx
import { auth0 } from '@/lib/auth0';

export default async function Home() {
  const session = await auth0.getSession();

  if (!session) {
    return (
      <main>
        <h1>Barkbook</h1>
        <a href="/auth/login">Log in</a>
      </main>
    );
  }

  return (
    <main>
      <h1>Welcome, {session.user.name}</h1>
      <a href="/dashboard">Dashboard</a>
      <a href="/auth/logout">Log out</a>
    </main>
  );
}
```

- [ ] **Step 8: Write `src/app/dashboard/page.tsx`** (protected — redirects unauthenticated users)

```tsx
import { redirect } from 'next/navigation';

import { auth0 } from '@/lib/auth0';

export default async function Dashboard() {
  const session = await auth0.getSession();

  if (!session) {
    redirect('/auth/login');
  }

  return (
    <main>
      <h1>Dashboard</h1>
      <p>Signed in as {session.user.email}</p>
    </main>
  );
}
```

- [ ] **Step 9: Commit**

```bash
git add apps/auth0-evals/src/evals/scaffolds/nextjs/auth0
git commit -m "feat(evals): add nextjs/auth0 scaffold with v4 login wired"
```

---

## Task 2: Verify the scaffold installs and builds

**Files:** none created — this is a verification gate.

The scaffold must be a valid starting point. Verify dependency install and a production build succeed before building the eval on top of it.

- [ ] **Step 1: Install dependencies in a throwaway copy**

```bash
TMP=$(mktemp -d)
cp -R apps/auth0-evals/src/evals/scaffolds/nextjs/auth0/. "$TMP"
cd "$TMP" && npm install
```
Expected: install completes; `@auth0/nextjs-auth0@4.x` and `next@16.2.7` resolve.

- [ ] **Step 2: Run the build**

```bash
cd "$TMP" && npm run build
```
Expected: `next build` completes without type or compile errors. The `/` and `/dashboard` routes appear in the route summary.

- [ ] **Step 3: Clean up**

```bash
rm -rf "$TMP"
cd /Users/frederikprijck/Development/auth0/auth0-evals/.claude/worktrees/nextjs-mfa
```

- [ ] **Step 4: If the build failed**, fix the scaffold files (most likely: a missing dep, a type error in a page, or wrong import path), re-run Steps 1-2, then amend Task 1's commit:

```bash
git add apps/auth0-evals/src/evals/scaffolds/nextjs/auth0
git commit -m "fix(evals): correct nextjs/auth0 scaffold build"
```

---

## Task 3: Write `PROMPT.md` for the `nextjs_mfa` eval

**Files:**
- Create: `apps/auth0-evals/src/evals/mfa/nextjs/PROMPT.md`

The prompt must NOT name the SDK package or the API methods (the eval measures whether the model picks them). It must state the three constraints that define the expected solution: (a) MFA required before the transfer, (b) token stays server-side, (c) use a popup (no full-page redirect away).

- [ ] **Step 1: Write `PROMPT.md`**

```markdown
---
id: nextjs_mfa
name: Next.js MFA Step-Up
scaffold: src/evals/scaffolds/nextjs/auth0
skills: auth0-nextjs,auth0-mfa
setup_command: npm install
---

## Task

My Next.js app (App Router) already has Auth0 login set up. I want to add a Transfer Funds
feature where the user must complete MFA before the transfer runs. If they haven't completed
MFA yet, prompt them for it.

Requirements:
- The transfer is authorized by calling a protected API with audience https://api.barkbook.com.
- The access token used to call that API must stay on the server — the browser must never
  receive or store it.
- When MFA is required, prompt the user with a popup so they are not redirected away from the
  page. After they complete MFA, the transfer should proceed.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
```

- [ ] **Step 2: Commit**

```bash
git add apps/auth0-evals/src/evals/mfa/nextjs/PROMPT.md
git commit -m "feat(evals): add nextjs_mfa PROMPT.md"
```

---

## Task 4: Write `graders.ts` for the `nextjs_mfa` eval

**Files:**
- Create: `apps/auth0-evals/src/evals/mfa/nextjs/graders.ts`
- Verify against: `apps/auth0-evals/src/evals/mfa/react/graders.ts` (sibling for style), `docs/ADDING_EVALS.md`

Graders follow the L1-L5 + holistic-judge convention. All imports use `.js`-less bare package specifier `@a0/eval-graders` (it's a package, not a relative path). Use `notContainsInSource` for creds (allowed in `.env.local`, not in source).

- [ ] **Step 1: Write `graders.ts`**

```typescript
import { contains, notContains, notContainsInSource, judge, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // ── L1: Required v4 reactive MFA symbols present ──────────────────────
    contains('@auth0/nextjs-auth0/server', 'Uses v4 server import path', GraderLevel.L1),
    contains('@auth0/nextjs-auth0/client', 'Uses v4 client import path', GraderLevel.L1),
    contains('MfaRequiredError', 'Handles MfaRequiredError from the SDK', GraderLevel.L1),
    contains('challengeWithPopup', 'Resolves MFA via mfa.challengeWithPopup popup flow', GraderLevel.L1),
    contains('getAccessToken', 'Requests an access token to trigger the step-up check', GraderLevel.L1),
    contains('https://api.barkbook.com', 'Targets the protected API audience', GraderLevel.L1),

    // ── L2: Hallucination / wrong SDK (React/SPA flow must be absent) ──────
    notContains('@auth0/auth0-react', 'Does not use the React SPA SDK in a Next.js app', GraderLevel.L2),
    notContains('getAccessTokenSilently', 'Does not use the SPA silent-token method', GraderLevel.L2),
    notContains('getIdTokenClaims', 'Does not inspect amr via getIdTokenClaims (SPA pattern)', GraderLevel.L2),
    notContains('speakeasy', 'No server-side TOTP library (speakeasy)', GraderLevel.L2),
    notContains('otplib', 'No server-side TOTP library (otplib)', GraderLevel.L2),
    notContains('@auth0/guardian', 'No fake Guardian client SDK referenced', GraderLevel.L2),

    // ── L3: Security ──────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in source files (ok in .env.local)',
      GraderLevel.L3,
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client ID in source files (ok in .env.local)',
      GraderLevel.L3,
    ),
    judge(
      'Is the access token for https://api.barkbook.com obtained and used only on the server ' +
        '(in a route handler or server action via auth0.getAccessToken), and never returned to ' +
        'the browser, written into a client component, or stored in localStorage/sessionStorage/cookies ' +
        'by application code? Answer yes only if the raw access token never crosses to the client.',
      GraderLevel.L3,
    ),

    // ── L4: Structural correctness ────────────────────────────────────────
    judge(
      'Does the server-side code call auth0.getAccessToken for the protected audience, catch ' +
        'MfaRequiredError, and surface it to the client as an error response (e.g. a 403 with the ' +
        'mfa_required code) rather than crashing or ignoring it?',
      GraderLevel.L4,
    ),
    judge(
      'When the client receives the mfa_required signal, does it call mfa.challengeWithPopup ' +
        '(from @auth0/nextjs-auth0/client) to complete MFA in a popup, and then retry the ' +
        'server-side action so the transfer proceeds after MFA succeeds?',
      GraderLevel.L4,
    ),

    // ── L5: Current v4 API patterns (reactive, not proactive SPA flow) ────
    judge(
      'Does the solution use the v4 reactive MFA step-up flow — triggering MFA by requesting an ' +
        'access token and handling MfaRequiredError — rather than the React SPA proactive pattern ' +
        'of passing acr_values/max_age in authorization params and inspecting the amr claim? It ' +
        'should also use v4 /auth/ routes and Auth0Client, not v3 /api/auth/ routes.',
      GraderLevel.L5,
    ),

    // ── Holistic judge (no level — always runs) ───────────────────────────
    judge(
      'Does the solution correctly implement reactive MFA step-up for a sensitive Transfer Funds ' +
        'action in a Next.js App Router app: the server requests a token for the protected audience ' +
        'and handles MfaRequiredError, the client resolves MFA via a popup (mfa.challengeWithPopup) ' +
        'without a full-page redirect, the transfer proceeds after MFA, and the access token stays ' +
        'server-side?',
    ),
  ];
}
```

- [ ] **Step 2: Build the project to type-check the graders**

```bash
npm run build
```
Expected: build succeeds; no TypeScript errors in `mfa/nextjs/graders.ts`. (If `@a0/eval-graders` exports are missing a symbol used here, the build fails — fix the import to match the package's actual exports, cross-checking `mfa/react/graders.ts` and `quickstarts/nextjs/graders.ts` which import the same primitives.)

- [ ] **Step 3: Commit**

```bash
git add apps/auth0-evals/src/evals/mfa/nextjs/graders.ts
git commit -m "feat(evals): add nextjs_mfa graders"
```

---

## Task 5: Verify the eval is discovered and lint/test pass

**Files:** none created — verification gate.

- [ ] **Step 1: Confirm auto-discovery lists `nextjs_mfa`**

```bash
npm run evals -- --eval nextjs_mfa --mode baseline --model claude-haiku-4-5 2>&1 | head -40
```
Expected: the run starts for eval `nextjs_mfa` (does NOT error with "unknown eval"). A baseline run is cheap and only needs the prompt/graders to load. It is fine if grader pass rates are low — we are confirming discovery and that graders execute without throwing.

- [ ] **Step 2: Run lint and the test suite**

```bash
npm run lint && npm test
```
Expected: lint clean; existing tests still pass (no test files were changed — graders/scaffolds are data, not logic).

- [ ] **Step 3: Run format**

```bash
npm run format
```

- [ ] **Step 4: Commit any formatting changes**

```bash
git add -A apps/auth0-evals/src/evals/mfa/nextjs apps/auth0-evals/src/evals/scaffolds/nextjs
git commit -m "chore(evals): format nextjs_mfa files" || echo "nothing to format"
```

---

## Task 6: Update the `auth0-mfa` skill's Next.js example (agent-skills repo)

**Files:**
- Create branch in `~/Development/auth0/agent-skills`
- Modify: `~/Development/auth0/agent-skills/plugins/auth0/skills/auth0-mfa/references/examples.md` (the Next.js (App Router) section, currently ~lines 121-178)

The current Next.js section shows `amr`-claim inspection + a `/api/auth/login?acr_values=...` redirect — both wrong for v4. Replace it with the reactive, server-held-token flow.

- [ ] **Step 1: Create a branch off `main`**

```bash
cd ~/Development/auth0/agent-skills
git checkout main && git pull --ff-only
git checkout -b feat/nextjs-mfa-step-up
```

- [ ] **Step 2: Read the current Next.js section to get exact boundaries**

```bash
grep -n -i 'next' plugins/auth0/skills/auth0-mfa/references/examples.md
```
Identify the start of the `### Next.js` (App Router) heading and the start of the next framework heading (e.g. `### Vue.js`). You will replace everything between them.

- [ ] **Step 3: Replace the Next.js section** with the following content (use the Edit tool, matching the existing heading text exactly as found in Step 2):

````markdown
### Next.js (App Router) — reactive step-up

The `@auth0/nextjs-auth0` v4 SDK does MFA step-up **reactively**, not proactively. You do not
pass `acr_values` or inspect the `amr` claim. Instead, MFA is enforced by an Auth0 post-login
**Action** on the protected audience; when you request an access token for that audience the SDK
throws `MfaRequiredError`, which you resolve with a popup. The access token stays on the server.

**1. Server route — request the token, surface `MfaRequiredError`:**

```ts
// app/api/transfer/route.ts
import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { MfaRequiredError } from '@auth0/nextjs-auth0/server';

export async function POST() {
  try {
    const { token } = await auth0.getAccessToken({
      audience: 'https://api.example.com',
      refresh: true,
    });

    // Use the token server-side to authorize the transfer. It never leaves the server.
    await fetch('https://api.example.com/transfer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MfaRequiredError) {
      return NextResponse.json(error.toJSON(), { status: 403 });
    }
    throw error;
  }
}
```

**2. Client component — resolve MFA with a popup, then retry:**

```tsx
'use client';

import { mfa } from '@auth0/nextjs-auth0/client';

export function TransferButton() {
  async function transfer() {
    let res = await fetch('/api/transfer', { method: 'POST' });

    if (res.status === 403 && (await res.clone().json()).error === 'mfa_required') {
      // Complete MFA in a popup (no full-page redirect). The stepped-up token is
      // cached in the server session by the SDK.
      await mfa.challengeWithPopup({ audience: 'https://api.example.com' });
      // Retry — the server now gets a token that satisfies MFA.
      res = await fetch('/api/transfer', { method: 'POST' });
    }

    return res.json();
  }

  return <button onClick={transfer}>Transfer funds</button>;
}
```

**3. Tenant: enforce MFA on the protected audience via a post-login Action** (otherwise
`getAccessToken` just succeeds and step-up never triggers). Set the tenant MFA policy to
Adaptive or Never, and challenge MFA in the Action only when the protected audience is requested.

> The default `acr_values` (`http://schemas.openid.net/pape/policies/2007/06/multi-factor`) is
> supplied by `challengeWithPopup()` — you do not hardcode it.
````

- [ ] **Step 4: Validate with skillsaw** (if available)

```bash
cd ~/Development/auth0/agent-skills
npx skillsaw lint plugins/auth0/skills/auth0-mfa 2>/dev/null || echo "skillsaw not available — skipping; verify frontmatter/kebab-case manually"
```
Expected: no errors. (Only `SKILL.md` in skill root; reference files kebab-case — we only edited an existing kebab-case file, so structure is unchanged.)

- [ ] **Step 5: Commit (do NOT push)**

```bash
git add plugins/auth0/skills/auth0-mfa/references/examples.md
git commit -m "fix(auth0-mfa): replace outdated Next.js MFA example with v4 reactive popup flow"
```

---

## Task 7: Add an MFA step-up reference to the `auth0-nextjs` skill (agent-skills repo)

**Files:**
- Create: `~/Development/auth0/agent-skills/plugins/auth0/skills/auth0-nextjs/references/mfa.md`
- Modify: `~/Development/auth0/agent-skills/plugins/auth0/skills/auth0-nextjs/SKILL.md` (link the new reference)

Keep framework-specific MFA guidance discoverable from the framework skill, pointing to the reactive flow. Stay on the same `feat/nextjs-mfa-step-up` branch.

- [ ] **Step 1: Create `references/mfa.md`**

````markdown
# MFA Step-Up (reactive)

`@auth0/nextjs-auth0` v4 implements MFA step-up **reactively**. There is no proactive
"request step-up" call and no server-side `amr`/`acr` claim inspection (that is the React SPA
pattern — do not use it here).

## Flow

1. A server route/action calls `auth0.getAccessToken({ audience, refresh: true })` for the
   protected audience.
2. An Auth0 post-login **Action** enforces MFA for that audience, so the token request returns
   `mfa_required`. The SDK throws `MfaRequiredError` (from `@auth0/nextjs-auth0/server`).
3. The server surfaces it to the client, e.g. `return NextResponse.json(error.toJSON(), { status: 403 })`.
4. The client calls `mfa.challengeWithPopup({ audience })` (from `@auth0/nextjs-auth0/client`)
   to complete MFA in a popup. The SDK caches the stepped-up token in the **server session**.
5. The client retries the server action; `getAccessToken` now succeeds server-side and the
   action proceeds. The access token never reaches the browser.

## Server route

```ts
import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { MfaRequiredError } from '@auth0/nextjs-auth0/server';

export async function POST() {
  try {
    const { token } = await auth0.getAccessToken({ audience: 'https://api.example.com', refresh: true });
    await fetch('https://api.example.com/transfer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MfaRequiredError) {
      return NextResponse.json(error.toJSON(), { status: 403 });
    }
    throw error;
  }
}
```

## Client component

```tsx
'use client';
import { mfa } from '@auth0/nextjs-auth0/client';

export function TransferButton() {
  async function transfer() {
    let res = await fetch('/api/transfer', { method: 'POST' });
    if (res.status === 403 && (await res.clone().json()).error === 'mfa_required') {
      await mfa.challengeWithPopup({ audience: 'https://api.example.com' });
      res = await fetch('/api/transfer', { method: 'POST' });
    }
    return res.json();
  }
  return <button onClick={transfer}>Transfer funds</button>;
}
```

## Tenant requirement

Enforce MFA on the protected audience via a post-login Action; otherwise `getAccessToken`
succeeds and step-up never triggers. Set the tenant MFA policy to Adaptive or Never. The default
`acr_values` (`http://schemas.openid.net/pape/policies/2007/06/multi-factor`) is supplied by
`challengeWithPopup()` — do not hardcode it.

See also the `auth0-mfa` skill for cross-framework MFA concepts.
````

- [ ] **Step 2: Link the reference from `SKILL.md`.** Read the "Detailed Documentation" (or equivalent references list) section and the "Related Skills" section:

```bash
grep -n -i 'detailed documentation\|references\|related skills\|setup.md\|integration.md\|api.md' ~/Development/auth0/agent-skills/plugins/auth0/skills/auth0-nextjs/SKILL.md
```

Add a bullet to the references list pointing to `references/mfa.md`, matching the existing bullet style. For example, if existing bullets read like `- [Setup](references/setup.md) — ...`, add:

```markdown
- [MFA Step-Up](references/mfa.md) — reactive MFA step-up for sensitive actions (popup, server-held token)
```

- [ ] **Step 3: Validate with skillsaw** (if available)

```bash
cd ~/Development/auth0/agent-skills
npx skillsaw lint plugins/auth0/skills/auth0-nextjs 2>/dev/null || echo "skillsaw not available — verify: only SKILL.md in root, references/mfa.md is kebab-case"
```
Expected: no errors. `references/mfa.md` is kebab-case and in the `references/` subdir.

- [ ] **Step 4: Commit (do NOT push)**

```bash
git add plugins/auth0/skills/auth0-nextjs/references/mfa.md plugins/auth0/skills/auth0-nextjs/SKILL.md
git commit -m "feat(auth0-nextjs): add reactive MFA step-up reference"
```

---

## Task 8: Smoke-test the eval with skills injected, keep the workspace

**Files:** none created — this exercises the full pipeline and produces a workspace for manual inspection.

Because skills live in a separate local checkout, confirm how this framework resolves local (unpushed) skills before relying on injection. See `docs/TESTING_SKILLS.md`.

- [ ] **Step 1: Read the skills-testing doc**

```bash
sed -n '1,120p' docs/TESTING_SKILLS.md
```
Follow whatever local-skill-path mechanism it documents (e.g. an env var or config pointing at `~/Development/auth0/agent-skills`). If it requires configuration, set it so the `feat/nextjs-mfa-step-up` branch content is used.

- [ ] **Step 2: Run the eval in agent mode with skills, keeping the workspace**

```bash
npm run evals -- --eval nextjs_mfa --mode agent --tools skills --model claude-sonnet-4-6 --keep-workspace 2>&1 | tail -40
```
Expected: the run completes; the output reports the kept workspace path. Note that path.

- [ ] **Step 3: Inspect the generated workspace** for the expected shape (does not need to be perfect — we are sanity-checking the eval runs end-to-end and graders fire):

```bash
# Use the workspace path printed in Step 2
find <WORKSPACE_PATH> -type f -not -path '*/node_modules/*' -not -path '*/.next/*' | sort
grep -rl 'challengeWithPopup\|MfaRequiredError' <WORKSPACE_PATH>/src 2>/dev/null
```
Expected: agent created a protected server route + a client component using `challengeWithPopup`. Confirm grader output in the run summary distinguishes pass/fail meaningfully (not all-pass, not all-fail).

- [ ] **Step 4: No commit** (this task produces no repo changes).

---

## Task 9: Write the manual live-test handoff checklist

**Files:**
- Create: `docs/superpowers/handoff/nextjs-mfa-live-test.md`

Captures exactly what the user must configure in their Auth0 tenant and `.env.local` to run the generated app and verify popup step-up by hand.

- [ ] **Step 1: Write the checklist**

````markdown
# Manual live-test: Next.js MFA step-up

Use this after generating an app with:

```bash
npm run evals -- --eval nextjs_mfa --mode agent --tools skills --model claude-sonnet-4-6 --keep-workspace
```

## 1. Auth0 tenant configuration

- [ ] **Application**: a Regular Web Application. Note its Domain, Client ID, Client Secret.
- [ ] **Allowed Callback URLs**: `http://localhost:3000/auth/callback`
- [ ] **Allowed Logout URLs**: `http://localhost:3000`
- [ ] **API**: an API with identifier (audience) `https://api.barkbook.com` (or your own — update the eval/app accordingly).
- [ ] **MFA factors**: enable at least one factor (e.g. One-Time Password / TOTP) under
      Security → Multi-factor Auth, and enroll your test user.
- [ ] **Tenant MFA policy**: set to **Adaptive** or **Never** (NOT "Always" — that blocks the
      background refresh the SDK relies on).
- [ ] **Post-login Action** that enforces MFA only when the protected audience is requested.
      Without this, `getAccessToken` succeeds and step-up never triggers. Example:

```js
exports.onExecutePostLogin = async (event, api) => {
  const audience = event.request?.query?.audience || event.resource_server?.identifier;
  const protectedApi = 'https://api.barkbook.com';
  if (audience === protectedApi) {
    const enrolled = (event.user.multifactor || []).length > 0;
    if (enrolled) {
      api.authentication.challengeWithAny([{ type: 'otp' }]);
    } else {
      api.authentication.enrollWithAny([{ type: 'otp' }]);
    }
  }
};
```

Attach the Action to the **Login** flow.

## 2. Fill in env vars

In the kept workspace, edit `.env.local`:

- [ ] `AUTH0_DOMAIN` = your tenant domain (e.g. `your-tenant.us.auth0.com`)
- [ ] `AUTH0_CLIENT_ID` = your app's Client ID
- [ ] `AUTH0_CLIENT_SECRET` = your app's Client Secret
- [ ] `AUTH0_SECRET` = output of `openssl rand -hex 32`
- [ ] `APP_BASE_URL` = `http://localhost:3000`

## 3. Run and verify

- [ ] `npm install` (if not already), then `npm run dev`.
- [ ] Visit `http://localhost:3000`, log in.
- [ ] Trigger the Transfer Funds action.
- [ ] Expect a **popup** (Auth0 Universal Login MFA), not a full-page redirect.
- [ ] Complete the MFA challenge in the popup; it closes automatically.
- [ ] The transfer completes after MFA.
- [ ] Confirm in browser devtools that the access token for `https://api.barkbook.com` is
      **never** present in any client-side network response, JS variable, or storage — the
      token call happens server-side only.
````

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/handoff/nextjs-mfa-live-test.md
git commit -m "docs: add manual live-test checklist for nextjs_mfa eval"
```

---

## Task 10: Update docs for the new eval

**Files:**
- Modify: `AGENTS.md` (if it maintains an eval list — verify first)

Per the AGENTS.md documentation table: "New eval added → AGENTS.md eval list (if maintaining one)". AGENTS.md describes eval *categories* and configurations rather than an exhaustive per-eval list, so likely no change is required — verify and only edit if there is a concrete list to extend.

- [ ] **Step 1: Check whether AGENTS.md enumerates individual evals**

```bash
grep -n -i 'react_mfa\|nextjs_quickstart\|react_quickstart\|eval list\|## Evals' AGENTS.md
```

- [ ] **Step 2:** If an explicit list exists that includes sibling evals like `react_mfa`, add a `nextjs_mfa` entry matching the format. If no such list exists (categories only), make no change and note it. Do not invent a new section.

- [ ] **Step 3: Commit only if changed**

```bash
git add AGENTS.md && git commit -m "docs: list nextjs_mfa eval in AGENTS.md" || echo "no AGENTS.md change needed"
```

---

## Task 11: Final verification

**Files:** none — final gate before handoff.

- [ ] **Step 1: Full build + test + lint in auth0-evals**

```bash
cd /Users/frederikprijck/Development/auth0/auth0-evals/.claude/worktrees/nextjs-mfa
npm run build && npm test && npm run lint
```
Expected: all pass.

- [ ] **Step 2: Confirm git state in both repos**

```bash
git -C /Users/frederikprijck/Development/auth0/auth0-evals/.claude/worktrees/nextjs-mfa status
git -C ~/Development/auth0/agent-skills status
git -C ~/Development/auth0/agent-skills log --oneline -3
```
Expected: auth0-evals worktree has the eval/scaffold/docs commits; agent-skills is on `feat/nextjs-mfa-step-up` with two commits, NOT pushed.

- [ ] **Step 3: Report to the user**: eval added, scaffold builds, skills updated on a local branch (unpushed), and point them to `docs/superpowers/handoff/nextjs-mfa-live-test.md` for the manual verification steps. Ask before pushing the agent-skills branch or opening any PR.
