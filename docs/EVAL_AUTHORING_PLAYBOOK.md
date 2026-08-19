# Eval Authoring Playbook

A practical guide to adding a new eval, derived by reading [PR #196](https://github.com/auth0/auth0-evals/pull/196)
(`feat(evals): add Swift and Android MFA step-up evals`) line by line.

That PR is the ideal template because it changed **no framework code** — it is pure "add an eval"
work: two evals, two scaffolds, two side fixes, +552/−0 across 16 files.

This document complements [`ADDING_EVALS.md`](ADDING_EVALS.md). That one is the reference for
frontmatter fields and primitive signatures; this one is the *judgement* — which primitive to
reach for, what makes a grader worthless, and the validation step that catches the bugs.

---

## Table of contents

- [The anatomy of PR #196](#the-anatomy-of-pr-196)
- [Part 1 — PROMPT.md](#part-1--promptmd)
- [Part 2 — graders.ts](#part-2--gradersts)
- [Part 3 — The scaffold](#part-3--the-scaffold)
- [Part 4 — Side fixes](#part-4--side-fixes)
- [Part 5 — Step-by-step playbook](#part-5--step-by-step-playbook)
- [Known framework bugs](#known-framework-bugs)
- [The 22 points, condensed](#the-22-points-condensed)

---

## The anatomy of PR #196

| Group | Files |
| ----- | ----- |
| Evals | `mfa/{swift,android}/PROMPT.md` + `graders.ts` (4 files, 205 lines) |
| Scaffolds | `scaffolds/swift/auth0/` (5 files, 117 lines) · `scaffolds/android/auth0/` (5 files, 219 lines) |
| Side fixes | `.gitignore` (+4), `apps/auth0-evals/README.md` (+7) |

Two commits. The second one — a one-line grader fix — is the most instructive thing in the PR.

---

## Part 1 — PROMPT.md

Both new evals are 14 lines. Android:

```yaml
---
id: android_mfa
name: Android MFA Step-Up
scaffold: src/evals/scaffolds/android/auth0
skills: auth0
---

## Task

My Android app already has Auth0 login working through Universal Login. I want to add a
Transfer Funds action where users must complete MFA before the transfer runs. If they
haven't done MFA yet, prompt them for it.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
```

### What's present, and what's deliberately absent

| Field | Value | Why |
| ----- | ----- | --- |
| `id` | `android_mfa` | snake_case; what `--eval` takes. **Required** |
| `name` | `Android MFA Step-Up` | report display |
| `scaffold` | path from framework root | resolved via `resolveInside()` — path traversal throws |
| `skills` | `auth0` | comma-separated; enables `--tools skills` |
| `setup_command` | **absent** | no dependency install possible in the sandbox |
| `compile_command` | **absent** | no Swift/Gradle toolchain in the sandbox |
| `category` | **absent** | inferred from the directory (`mfa/`) |
| `## System` | **absent** | only feeds baseline mode; falls back to the framework default |

Compare `mfa/react/PROMPT.md` — identical in shape, but *has* both commands:

```yaml
setup_command: npm install
compile_command: npm run build
```

> **Point 1 — omitting `compile_command` is a decision with three consequences,** and you need all three:
>
> 1. `compiles()` cannot be used as a grader (it fails outright without the frontmatter field)
> 2. the build-verification instruction is not injected into the agent's context file
> 3. L4 must therefore be carried entirely by judges
>
> That's exactly why `mfa/react/graders.ts` has `compiles(...)` and the two mobile files have zero
> deterministic L4 graders.

### Write the prompt as a user would

"My Android app already has Auth0 login working through Universal Login."

Note what is **not** said: no mention of `acr_values`, `amr`, `max_age`, or `WebAuthProvider`.
Every one of those is graded. **The prompt must not leak the answer** — the eval measures whether
the agent knows the MFA step-up pattern, so naming the pattern would measure nothing.

It is also deliberately *underspecified*. "If they haven't done MFA yet, prompt them for it" is how
a real developer asks. The agent has to infer that "have they done MFA" means reading the `amr` claim.

The three credentials are fake but **consistent across every eval in the repo** — same domain, same
client ID, same audience. That consistency is what lets the L3 graders hardcode
`'barkbook_client_abc123xyz'` as a needle.

---

## Part 2 — graders.ts

Swift ships 15 graders, Android 17. Both follow one rigid skeleton:

```typescript
import { contains, notContains, notContainsInSource, matches, judge, GraderLevel } from '@a0/evals-graders';

export function defineGraders() {
  return [
    // ── L1: Required MFA step-up symbols present ───────
    // ── L2: Hallucination / wrong approach ────────────
    // ── L3: Security ──────────────────────────────────
    // ── L4: Structural correctness ────────────────────
    // ── L5: Current API patterns ──────────────────────
    // ── Holistic judge (no level — always runs) ───────
  ];
}
```

> **Point 2 — the contract is exact:** a named export `defineGraders()` returning a flat array.
> `loader.ts` throws `EvalConfigError` if the function is missing. Box-drawing section comments per
> level are the house style — copy them.

### L1 — presence (4 Swift / 5 Android)

Three are shared:

```typescript
contains('acr_values', 'Step-up request uses acr_values parameter', GraderLevel.L1),
contains('amr', 'AMR claim checked to detect prior MFA completion', GraderLevel.L1),
contains(
  'schemas.openid.net/pape/policies/2007/06/multi-factor',
  'Uses correct multi-factor acr_values policy URI',
  GraderLevel.L1,
),
```

That third one is the highest-value L1 grader in the file: a **long, exact, unguessable string**.
An agent that half-remembers MFA step-up writes `acr_values: 'mfa'` and fails. Only an agent that
actually knows the OIDC PAPE policy URI passes.

> **Point 3 — prefer long exact strings for L1.** `contains('amr')` is weak (4 chars, could appear
> in a comment); the policy URI is strong.

Then the platform-specific ones — and here is the PR's most transferable technique:

```typescript
// Auth0.swift exposes claims two legitimate ways: JWTDecode (a public
// dependency of the SDK) or CredentialsManager.userProfile()?.customClaims.
matches(
  String.raw`decode\(jwt:|customClaims`,
  'Reads ID token claims via JWTDecode or UserProfile.customClaims',
  GraderLevel.L1,
),
```

Android's equivalent:

```typescript
matches(
  String.raw`getExtraInfo\(\)|com\.auth0\.android:jwtdecode`,
  'Reads ID token claims via UserProfile.getExtraInfo() or the jwtdecode library',
  GraderLevel.L1,
),
```

> **Point 4 — when an SDK offers two legitimate ways to do something, use `matches` with an
> alternation, not `contains`.** The PR states the principle: *"The graders accept either legitimate
> way of doing each step, so correct solutions aren't failed on style."* A `contains('getExtraInfo')`
> would fail a correct solution that used `jwtdecode`. That's a broken grader — it measures style
> conformity, not correctness.

> **Point 5 — always use `String.raw` for regex patterns.** `String.raw` + `\(` survives; a normal
> string needs `\\(`. Every `matches` in the repo uses it.

Android has one extra L1 that Swift lacks:

```typescript
contains('withParameters', 'Passes acr_values through WebAuthProvider withParameters', GraderLevel.L1),
```

Asymmetric on purpose. Android's builder API has one canonical name; Swift's has two
(`.parameters` / `.maxAge`), so on Swift that check moved to L5 as a `matches` alternation.
**Graders track the SDK's actual API surface, not a template.**

### L2 — hallucination (3 Swift / 4 Android)

Each names a *specific plausible mistake*:

```typescript
// Swift
notContains('Auth0SDK', 'No hallucinated Auth0SDK package name (correct package is Auth0)', GraderLevel.L2),

// Android
notContains('auth0-java', 'No auth0-java (server-side SDK, not for Android)', GraderLevel.L2),
notContains('credentials.claims', 'No hallucinated Credentials.claims property', GraderLevel.L2),
```

Three failure archetypes worth naming, because they recur on every platform:

| Archetype | Example | Why an LLM does it |
| --------- | ------- | ------------------ |
| Invented package name | `Auth0SDK` | plausible-sounding, wrong |
| Right vendor, wrong variant | `auth0-java` on Android | server SDK in a mobile app |
| Invented property on a real type | `credentials.claims` | Auth0.Android has no `Credentials.claims` — claims come from `credentials.user` |

> **Point 6 — L2 needles come from observed failures, not imagination.** The PR's testing section
> confirms it: *"two hand-rolled Base64 JWT parsing, one set `withMaxAge(0)` only behind a flag."*
> Run the eval, watch what breaks, encode it.

Then the shared wrong-approach pair:

```typescript
notContains(
  'mfaToken',
  'Does not use the embedded MFA grant (MfaApiClient) — wrong approach for a Universal Login app',
  GraderLevel.L2,
  { caseSensitive: false },
),
notContains('mfa/challenge', 'Does not call the raw MFA challenge endpoint', GraderLevel.L2),
```

This penalises a *technically working but architecturally wrong* solution. The embedded MFA grant
is real Auth0 API — it is simply wrong for a Universal Login app. **L2 catches "wrong approach," not
only "fake API."**

### 🔑 The second commit — the most valuable lesson in the PR

Commit 1 shipped:

```typescript
notContains('mfaClient', ...)   // ← broken
```

Commit 2 fixed it. The message:

> `notContains` is case-sensitive, and `'mfaClient'` names neither SDK's symbol — Auth0.swift has an
> `MFAClient` protocol reached via `Auth0.mfa()` (the type is often never named), Auth0.Android has
> `MfaApiClient`. Match `mfaToken` case-insensitively instead, which every embedded-MFA path carries.

Three compounding bugs in one 10-character needle:

1. **Case.** `notContains` defaults to `caseSensitive: true`. `'mfaClient'` ≠ `MFAClient` ≠ `MfaApiClient`.
2. **Wrong symbol.** Neither SDK has a type called `mfaClient`.
3. **Unnamed type.** Even on Swift the correct type is often *never written* —
   `Auth0.mfa().verify(otp:mfaToken:)` names no type at all.

> **Point 7 — a `notContains` with an impossible needle always passes, and silently.** No error, no
> warning, no signal. It looks like a grader; it is dead weight inflating your L2 score. This is
> AGENTS.md's *"if every model passes, the eval is broken"* in miniature.

The fix generalises: **anchor negative graders on the wire-level artifact, not the type name.**
`mfaToken` is the parameter every embedded-MFA path must carry, whatever the type is called. Wire
formats are stable; type names vary by SDK, language, and version.

> **Point 8 — know the case-sensitivity defaults, they differ:**
>
> | Primitive | Default |
> | --------- | ------- |
> | `contains` | **case-sensitive** |
> | `notContains` | **case-sensitive** |
> | `notContainsInSource` | **case-sensitive** |
> | `matches` | **case-INsensitive** |
>
> `matches` is the odd one out. To tolerate casing on a `contains`/`notContains`, pass
> `{ caseSensitive: false }` as the 4th argument.

> **Point 9 — how to catch this class of bug.** The PR describes the method, and it is the single
> most useful practice in this document:
>
> > Ran the deterministic graders against the bare scaffolds and against a hand-written correct
> > solution for each platform: everything positive fails on the scaffold, everything passes on the
> > correct solution. That caught two graders the scaffold itself already satisfied.
>
> Two assertions, both necessary:
>
> - **against the bare scaffold** → every positive grader must FAIL (else it is satisfied by
>   scaffold code and measures nothing)
> - **against a hand-written correct solution** → every grader must PASS (else it rejects a
>   legitimate answer)

### L3 — security (3 each)

The deterministic pair:

```typescript
notContainsInSource(
  'barkbook_client_abc123xyz',
  'No hardcoded client ID in Kotlin source files (ok in strings.xml)',
  GraderLevel.L3,
),
notContainsInSource(
  'dev-barkbook.us.auth0.com',
  'No hardcoded domain in Kotlin source files (ok in strings.xml)',
  GraderLevel.L3,
),
```

> **Point 10 — use `notContainsInSource`, never `notContains`, for credentials.** They legitimately
> live in config. `not-contains-in-source.ts` skips any file matching:
>
> ```typescript
> NON_SOURCE_EXTS = /\.(?:env|json|plist|xml|yaml|yml|toml|ini|cfg|conf|md)$/i
> NON_SOURCE_PREFIXES = /^\.env/
> ```
>
> `.plist` and `.xml` are both there — which is exactly why the Swift scaffold can ship `Auth0.plist`
> with the real client ID and the Android scaffold can ship `strings.xml`, and both L3 graders still
> pass on the untouched scaffold. **Read that regex before writing an L3 grader**; if your platform's
> config format is not in it, `notContainsInSource` will not help you.

Then a judge for what regex cannot express:

```typescript
judge(
  'Does the code let SecureCredentialsManager (or CredentialsManager) handle token storage rather than ' +
    'persisting Auth0 tokens (access tokens, ID tokens, refresh tokens) by hand in SharedPreferences? ' +
    'Storing application state such as a pending transfer is acceptable — only manual token storage is a violation.',
  GraderLevel.L3,
),
```

> **Point 11 — carve out the false positive explicitly.** That final clause is essential: the correct
> solution for this task *must* stash a pending transfer across the step-up redirect. Without the
> carve-out, the judge fails correct code. The React MFA eval has the same carve-out for `sessionStorage`.

Note this is the platform-appropriate translation of React's `localStorage`/`sessionStorage` check:
SharedPreferences on Android, UserDefaults/Keychain on Swift. **Same security question, platform-native
vocabulary.**

### L4 — structural (2 judges each)

No `compiles()`, because there is no toolchain. Both judges accept either implementation:

```typescript
judge(
  'Does the code check the amr claim before executing the transfer action, and only proceed when ' +
    '"mfa" is present in the amr array? Reading amr via credentials.user.getExtraInfo()["amr"] or via ' +
    'the com.auth0.android:jwtdecode library are both acceptable.',
  GraderLevel.L4,
),
judge(
  'When MFA is missing, is step-up performed by launching a new WebAuthProvider.login(...) — with ' +
    'withScheme and the MFA acr_values — rather than by calling the Authentication API MFA endpoints ' +
    '(challenge/verify) directly?',
  GraderLevel.L4,
),
```

> **Point 12 — the judge-prompt formula that recurs throughout this PR:**
>
> ```
> Does the code <specific observable behavior>?
>   <Acceptable variant A> or <acceptable variant B> are both acceptable.
>   ... rather than <the wrong approach>?
> ```
>
> Naming the wrong approach inline is what makes a judge deterministic enough to be useful. A bare
> "Does it handle MFA correctly?" gets you coin flips.

> **Point 13 — L4 asks "is it wired correctly," ordering included.** Note "*before* executing the
> transfer action" and "only proceed when." A solution that checks `amr` *after* the transfer would
> satisfy L1 (`amr` present) and fail L4. That is the level boundary working as designed.

### L5 — version correctness (2 each)

L5 **only runs in agent+mcp configs** — the model had docs access, so a deprecated API is a real
failure rather than a knowledge gap.

Swift pairs a deterministic check with a judge:

```typescript
// `.parameters` / `.maxAge` are the current builders for extra authorization
// parameters. The scaffold's login call uses neither, so this only passes if
// the agent built the step-up request itself.
matches(
  String.raw`\.parameters\(|\.maxAge\(`,
  'Step-up parameters passed through the current .parameters/.maxAge builders',
  GraderLevel.L5,
),
judge(
  'Does the step-up request force fresh authentication with a max_age of 0, so a cached session is ' +
    'not reused? Either the dedicated .maxAge(0) builder or "max_age" inside .parameters([...]) counts.',
  GraderLevel.L5,
),
```

That inline comment is doing real work: **"The scaffold's login call uses neither, so this only
passes if the agent built the step-up request itself."** That is the scaffold-independence proof,
written down at the grader. Check the scaffold and you will see `AuthenticationService.swift` uses
`.useHTTPS()`, `.audience()`, `.scope()` — deliberately *not* `.parameters` or `.maxAge`.

> **Point 14 — this is the discipline the PR calls out: "two graders the scaffold itself already
> satisfied, now scoped to the step-up request."** Every positive grader must be unsatisfiable by the
> scaffold alone. Write the reason as a comment.

Android's second L5 goes after a removed entry point:

```typescript
judge(
  'Is the step-up request built with the current v2+ builder API — WebAuthProvider.login(account) ' +
    'with withScheme and withParameters/withMaxAge — rather than by hand-building an /authorize URL ' +
    'or using the removed WebAuthProvider.init entry point?',
  GraderLevel.L5,
),
```

> **Point 15 — L5 targets *removed or deprecated* API by name.** `WebAuthProvider.init` was the v1
> entry point. This is the check that catches a model trained on old docs. Two wrong approaches named
> in one question: hand-rolled URL, and the removed init.

### The holistic judge — no level

```typescript
judge(
  'Does the solution correctly implement MFA step-up authentication in an Android app — reading the amr ' +
    'claim from the ID token (via credentials.user.getExtraInfo() or the jwtdecode library), requesting ' +
    'step-up through WebAuthProvider.login with acr_values and max_age 0 when MFA is not present, and ' +
    'gating the Transfer Funds action behind MFA verification?',
),
```

> **Point 16 — exactly one, always last, no level argument.** No level means the engine never filters
> it out — it runs in all five configurations, including baseline. Structurally it is the whole task
> restated as one question, with the acceptable variants named. It is your safety net: if 14 graders
> pass and this fails, your graders are measuring the wrong things.

### Grader counts reconcile with the reported runs

| Eval | L1 | L2 | L3 | L4 | L5 | holistic | baseline | agent | agent+mcp |
| ---- | -- | -- | -- | -- | -- | -------- | -------- | ----- | --------- |
| `swift_mfa` | 4 | 3 | 3 | 2 | 2 | 1 | **11** | **13** | **15** |
| `android_mfa` | 5 | 4 | 3 | 2 | 2 | 1 | **13** | **15** | **17** |

Those denominators match the PR's results table exactly (`5/11`, `10/13`, `7/15`; `7/13`, `13/15`,
`14/17`). A useful sanity check: **compute the expected denominators per configuration and confirm
against the run output.**

---

## Part 3 — The scaffold

### Swift — `scaffolds/swift/auth0/` (5 files)

```
AGENTS.md                                          3   don't run builds
Auth0.plist                                       10   ClientId + Domain
Package.swift                                     24   Auth0.swift from 3.0.0
Sources/BarkbookApp/AuthenticationService.swift   42   login/logout, CredentialsManager
Sources/BarkbookApp/ContentView.swift             38   SwiftUI, Login/Logout buttons
```

### Android — `scaffolds/android/auth0/` (5 files)

```
AGENTS.md                                             3   don't run builds
app/build.gradle                                     48   com.auth0.android:auth0:4.0.1, manifestPlaceholders
app/src/main/AndroidManifest.xml                     23   MainActivity, INTERNET permission
app/src/main/java/com/barkbook/app/MainActivity.kt  139   Compose, WebAuthProvider, SecureCredentialsManager
app/src/main/res/values/strings.xml                   6   domain, client id, scheme
```

### The scaffold design rule

> **Point 17 — the scaffold is "everything except the task."** Login works; Transfer Funds does not
> exist. From the PR: *"a login-only app with Auth0 already wired, no Transfer Funds UI, since
> building the feature is the task."*

Concretely, the Swift scaffold's `login()`:

```swift
let credentials = try await Auth0
    .webAuth()
    .useHTTPS()
    .audience("https://api.barkbook.com")
    .scope("openid profile email offline_access")
    .start()
```

`.useHTTPS()`, `.audience()`, `.scope()` — and **deliberately not** `.parameters()` or `.maxAge()`.
That single omission is what makes the L5 `matches` grader meaningful.

Same discipline on Android: `MainActivity.kt` uses `.withScheme()`, `.withAudience()`, `.withScope()`,
and **not** `withParameters` — which is what makes Android's L1 `contains('withParameters')` a real
check rather than a freebie.

> **Point 18 — audit your scaffold against every positive grader.** For each one: does the scaffold
> already satisfy it? If yes, either the grader or the scaffold is wrong. This is a mechanical check
> and it is where the PR caught two bugs.

Two more scaffold details worth copying:

- **The scaffold uses `offline_access`** and `SecureCredentialsManager` / `CredentialsManager` — the
  *secure* pattern is pre-established, so the agent has to actively regress to fail L3.
- **Credentials live only in config** — `Auth0.plist` and `strings.xml`, never in `.swift` or `.kt`.
  Consistent with the L3 graders, and it means the scaffold passes L3 unmodified.

### 🔑 The AGENTS.md trick

Both scaffolds ship a 3-line `AGENTS.md`:

```markdown
# Android MFA — Agent Guidance

Do not run build or compile commands (do not run `./gradlew`, `gradle assembleDebug`, or
similar). You may edit any project files — Kotlin source, `build.gradle`, `strings.xml`,
`AndroidManifest.xml` — but do not attempt to compile or verify the build.
```

This exploits a specific mechanism in `workspace.ts` (`writeAgentGuidance`):

```typescript
// If the scaffold shipped AGENTS.md but the active runner reads a different
// file, rename it so the guidance reaches the right runner.
const scaffoldAgentsMd = join(workspace, 'AGENTS.md');
if (filename !== 'AGENTS.md' && existsSync(scaffoldAgentsMd) && !existsSync(dest)) {
  renameSync(scaffoldAgentsMd, dest);
}
if (existsSync(dest)) {
  appendFileSync(dest, `\n${guidance}`, 'utf-8');
}
```

> **Point 19 — ship scaffold guidance as `AGENTS.md` and the framework routes it per runner.**
> `AGENT_CONTEXT_FILENAMES` maps claude-code → `CLAUDE.md`, gemini-cli → `GEMINI.md`,
> codex → `AGENTS.md`, copilot → `.github/copilot-instructions.md`. Your `AGENTS.md` is renamed to
> whichever file the active runner reads, then the framework *appends* its own guidance. Write
> `AGENTS.md` once and all four runners see it.

It is never graded — `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` are all in `EXCLUDED_EVAL_FILES`, and
`.github/` is in `EXCLUDED_EVAL_DIRS`.

> **Point 20 — why suppress builds at all.** Without it the agent burns its 75-turn budget and
> 30-minute timeout on `./gradlew` invocations that cannot succeed (no Android SDK in the sandbox),
> then scores terribly on Setup Speed and Efficiency for an infrastructure reason. You would be
> measuring the sandbox, not the model. Suppressing builds keeps process scoring honest.

---

## Part 4 — Side fixes

**`.gitignore` (+4)** — mechanical but necessary:

```gitignore
**/.build/          # Swift Package Manager build output
**/.gradle/         # Gradle
```

Both scaffolds accrue build residue when worked on locally.

**`apps/auth0-evals/README.md` (+7)** — the eval table listed quickstarts only, so the author
backfilled all 7 missing rows (`react_mfa`, `vue_mfa`, `angular_mfa`, `mfa_tenant_cli`, `spa_js_dpop`)
alongside the 2 new ones.

> **Point 21 — updating the eval table is part of adding an eval.** AGENTS.md's docs table makes it
> explicit: *"New eval added → AGENTS.md eval list; docs/ADDING_EVALS.md if the change reveals a gap."*
> Note the PR's honest scoping too: *"No new primitives, levels or flags, so the other docs stay
> accurate."* Update what your change affects, not everything.

---

## Part 5 — Step-by-step playbook

### Step 0 — Pick your reference

Copy the closest existing eval; do not start blank.

| Building | Copy |
| -------- | ---- |
| Web quickstart | `quickstarts/react/` |
| Mobile quickstart | `quickstarts/swift/` or `android/` |
| Feature on an existing app | `mfa/react/` (web) · `mfa/swift/` or `mfa/android/` (mobile) |
| API protection | `quickstarts/express-api/` |
| CLI / tenant config | `mfa/tenant-cli/` |
| MCP-only (no files written) | any eval using `source: 'response'` |

### Step 1 — Decide toolchain support first

This decision cascades through everything else:

| Sandbox has the toolchain? | `setup_command` | `compile_command` | L4 | Scaffold `AGENTS.md` |
| -------------------------- | --------------- | ----------------- | -- | -------------------- |
| Yes (Node, Python) | ✅ e.g. `npm install` | ✅ e.g. `npm run build` | `compiles()` + judges | not needed |
| No (Swift, Android, iOS) | ❌ omit | ❌ omit | judges only | ✅ suppress builds |

### Step 2 — Build the scaffold

- Everything **except** the task. The feature you are grading must not exist.
- Credentials in config only (`.plist`, `.xml`, `.env`, `.json`) — never in source.
- Use the same fake trio: `dev-barkbook.us.auth0.com` / `barkbook_client_abc123xyz` /
  `https://api.barkbook.com`.
- Use the *secure* pattern already (CredentialsManager, `offline_access`) so a regression is the
  agent's fault.
- **Deliberately avoid the API surface you grade** — check your L5 needles against the scaffold.
- No toolchain → add `AGENTS.md` suppressing builds.
- Add build-output dirs to `.gitignore`.

### Step 3 — Write PROMPT.md

```yaml
---
id: <platform>_<feature>          # snake_case, required
name: <Platform> <Feature>
scaffold: src/evals/scaffolds/<platform>/<variant>
skills: auth0
# setup_command / compile_command only if the toolchain exists
---

## Task

<How a real developer would ask. Underspecified. No API names.>

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
```

### Step 4 — Write graders.ts

Work down the levels:

**L1 (3–5)** — required symbols. Favour long exact strings (policy URIs, full package names). Two
legitimate approaches → `matches` + `String.raw` alternation, with a comment naming both.

**L2 (3–4)** — one per specific plausible mistake:

- invented package name
- right vendor / wrong variant (server SDK in a client app)
- invented property on a real type
- architecturally wrong approach that technically works

Anchor on **wire-level artifacts** (`mfaToken`, `mfa/challenge`), not type names. Pass
`{ caseSensitive: false }` when casing varies.

**L3 (2–3)** — `notContainsInSource` for each credential (check `NON_SOURCE_EXTS` covers your config
format), plus a judge for insecure storage **with the legitimate-app-state carve-out**.

**L4 (2–3)** — `compiles()` if you have a toolchain. Judges for wiring and ordering ("*before* the
action", "only proceed when"). Name acceptable variants; name the wrong approach.

**L5 (2)** — current vs. deprecated API. Name removed entry points explicitly. Verify against the
scaffold and write the reason as a comment.

**Holistic (1)** — exactly one `judge()`, last, **no level**. Restate the whole task with acceptable
variants named.

### Step 5 — Validate (do not skip)

```bash
npm run build && npm test && npm run lint
```

Then the two-sided check that caught this PR's bugs:

1. **Against the bare scaffold** — every positive grader must FAIL. Any that passes is satisfied by
   scaffold code and measures nothing.
2. **Against a hand-written correct solution** — every grader must PASS. Any that fails rejects a
   legitimate answer.

Then verify each `notContains` needle actually appears somewhere in the wrong implementation.
**A negative grader with an impossible needle passes silently forever.**

Finally, compute expected denominators per configuration and check them against a real run.

### Step 6 — Run it

```bash
npm run evals -- --eval <id> --mode agent --keep-workspace
npm run evals -- --eval <id> --mode agent --tools mcp,skills
```

Read the failures. Are they *specific* (a real mistake) or *noisy* (grader too strict)? The PR's bar:
*"Failures are specific, not noisy."* Specific failures mean your graders work. Noisy means loosen
with an alternation.

### Step 7 — Docs

Add a row to `apps/auth0-evals/README.md`. Update other docs only if you changed primitives, levels,
or flags.

---

## Known framework bugs

Worth knowing before trusting a baseline column. These are **pre-existing, not caused by #196**; the
author flagged them as follow-ups:

1. **`runBaseline` sets no `maxOutputTokens` and does not disable thinking.** On Opus 5 the answer
   goes to reasoning tokens — `swift_mfa` baseline returned 0 characters. (The judge path already
   fixes this via `thinking: { type: 'disabled' }` + `maxTokens: 4096`; `runBaseline` did not get the
   same treatment.)
2. **Baseline judges always see an empty corpus** — `gradeText` writes to `llm_response.txt` and the
   judge excludes `.txt`.

> **Point 22 — treat baseline numbers as unreliable until those land.** Grade on agent-mode columns.

---

## The 22 points, condensed

**PROMPT.md**

1. Omitting `compile_command` cascades: no `compiles()`, no build guidance, judge-only L4
2. The contract is exact — `defineGraders()` named export, flat array

**L1**

3. Long exact strings beat short ones
4. Two legitimate approaches → `matches` alternation, not `contains`
5. Always `String.raw` for patterns

**L2**

6. Needles come from observed failures
7. **An impossible needle passes silently** — the PR's own bug
8. Case defaults differ: `contains`/`notContains` sensitive, `matches` insensitive
9. Two-sided validation: fail on scaffold, pass on correct solution

**L3**

10. `notContainsInSource` for credentials; check `NON_SOURCE_EXTS`
11. Carve out legitimate non-token storage explicitly

**L4 / L5**

12. Judge formula: specific behavior + acceptable variants + wrong approach named
13. L4 grades wiring *and ordering*
14. Every positive grader must be unsatisfiable by the scaffold — comment the reason
15. L5 names removed/deprecated API explicitly
16. Exactly one holistic judge, last, no level

**Scaffold**

17. Everything except the task
18. Audit the scaffold against every positive grader
19. Ship guidance as `AGENTS.md` — the framework routes it per runner
20. Suppress impossible builds so process scoring stays honest

**Process**

21. The eval table is part of the deliverable
22. Baseline columns are unreliable pending two framework fixes

---

The single highest-leverage habit is **Step 5's two-sided validation**. Everything else is convention
you can copy from a reference eval; that check is the only thing standing between you and a grader
that looks right, passes CI, and measures nothing.
