# Scoring Methodology — Decision Rationale

This document captures the **why** behind methodology decisions — rationale, alternatives considered, and open questions. Git history tracks when changes happened; this file tracks why.

AGENTS.md is the spec (formulas, constants, edge cases). This file is the reasoning. Agents don't need this file — humans do.

## Workflow for methodology changes

1. Author proposes the change in this file (rationale, options, recommendation)
2. PR review → merge to master
3. Engineer implements the code change
4. AGENTS.md updated to reflect current state

---

## Philosophy

Scores must match what a developer actually experiences. If we publish a score of 93 and a developer tries the same task with the same model and gets a broken app, we've lost their trust permanently. Everything in this framework is designed to prevent that gap.

**Real prompts.** Eval prompts are short and realistic — the kind of thing a developer actually types ("add authentication to my Next.js app"), not a detailed recipe with step-by-step instructions. Prompts are 25–90 words, never hundreds. The configuration (mode, tools) provides context, not the prompt.

**Real agents.** Evals run on the same agent runtimes developers use — Claude Code, GitHub Copilot, Gemini CLI — not a synthetic API-only harness. The agent gets a workspace, a shell, and file tools, just like a developer's environment.

**Honest baselines.** Baseline mode (single LLM call, no tools) shows what the model knows from training data alone. Agent+tools modes show what Auth0's investment adds. The delta between them is the product — it quantifies the ROI of skills, MCP, and docs in a way that's reproducible. We don't inflate baselines with fat prompts to make scores look good; we show the honest starting point and the honest lift.

---

## Grader level rationale

- **L1–L3 run in all configs including baseline.** Even a single LLM call with no tools should know the correct imports, not invent packages, and not hardcode secrets. These are training-data knowledge checks — if the model gets them wrong without tools, that's a real signal.
- **L4 runs in agent configs only.** Structural correctness (right components in right files, lifecycle hooks wired, middleware order) requires actually writing a project. Baseline produces a single response, not a file tree — structural checks are meaningless against it.
- **L5 runs in agent+MCP configs only.** Penalizing deprecated API usage is only fair when the model has access to current docs via MCP. Without docs, using a deprecated pattern reflects stale training data, not a failure the agent could have avoided.

---

## Process / Output split — why 50/50?

Guiding principle #5: "The journey matters as much as the destination." A perfect output produced through 50 retries and 10 interruptions isn't a good developer experience. The 50/50 split ensures process quality can't be ignored even when the final code is correct.

Process dimensions: Setup Friction (12%) + Setup Speed (12%) + Efficiency (12%) + Error Recovery (7%) + Docs Quality (7%) = 50%.
Output dimensions: Correctness (25%) + Hallucination (15%) + Security (10%) = 50%.

---

## Grade thresholds

| Grade | Min score | Meaning |
|-------|-----------|---------|
| A | 90 | Production-ready. At most 1–2 minor issues across all dimensions. |
| B | 75 | Fundamentally sound but with notable gaps — missing imports, slow execution, or a hallucination. |
| C | 60 | Passing. The output is usable but required significant cleanup or had process issues. |
| D | 40 | Below passing. Major correctness failures or severe process problems. |
| F | < 40 | Failed. Output is not useful — the developer would be faster starting from scratch. |

Calibrated to match developer intuition. When we show engineers a run scored 91, it should feel like an A — one they'd accept with minimal review. A run scored 55 should feel like a C — technically present but requiring real work to fix. The gaps between grades are uneven: A→B and B→C are both 15 points (tight at the top), C→D is 20 (wide gap separating "passing" from "failing"), and D→F spans 40 points (hard to get an F if anything works at all).

---

## Dimension weights — rationale

### Setup Friction — 12%

Interruptions are the single biggest friction point in agent-assisted development. If the agent stops to ask "what's your domain?" or "what framework do you want?", the entire value prop of autonomous setup breaks. A developer who has to answer 5 questions might as well have read the quickstart docs.

**Constant: interruption penalty = 14.** Calibrated so 7 interruptions = score 0. A quickstart that asks 7 questions has failed its purpose — the developer would have been faster reading the docs.

**Constant: provider error penalty = 10 (less than interruptions).** Provider errors are infrastructure problems, not agent behavior — they're frustrating but not the agent's fault. Still penalized because they affect the developer experience regardless of cause.

### Setup Speed — 12%

Speed matters but less than friction — a slow clean run beats a fast messy one. And speed is partially outside the agent's control (API latency, model inference time).

**Why active time, not wall time?** Wall time includes network latency, queuing, and parallelism effects that vary by infrastructure. Active tool time isolates what the agent actually spent doing work, making scores comparable across different environments.

**Constant: ideal = 60s.** A well-executed quickstart needs ~10 tool calls (read scaffold, write a few files, install deps, maybe run a build). At ~6s per tool call average, 60s is a clean run. Observed top-performing runs cluster around 40–80s active time.

**Constant: degradation rate = 0.4 (ceiling at 310s).** 5+ minutes of active tool execution for a quickstart means the agent is thrashing — retrying failed commands, reading unnecessary files, or going in circles.

### Efficiency — 12%

Measures whether the agent solved the task in a focused way or thrashed — reading files it didn't need, retrying failed writes, overwriting its own output.

**Why waste-detection, not call-counting?** The original formula (`min(100, 100 × 10 / max(10, total_calls))`) penalized complexity, not waste. A Next.js quickstart legitimately needs 30-40 tool calls (read scaffold, write server components, client components, middleware, route handlers, config). The old formula scored that 25% — same as a flailing agent. Frameworks with more files to read and write were structurally penalized regardless of agent quality.

The replacement uses heuristic waste detection on session trace metadata we already capture. Each tool call has `causedError`, `isRetry`, `isInterruption`, and full `args` (including file paths). Waste is defined as:

1. **Duplicate reads** — reading the same file path twice with no intervening write or command execution that could modify that file. The second read is treated as likely redundant. Note: `run_command` can mutate files (formatters, generators, installs); the implementation should treat any `run_command` between two reads of the same path as a potential mutation, resetting the duplicate-read tracking for affected paths.
2. **Errored calls** — any tool call where `causedError = true` OR `isRetry = true`. Retries imply the prior attempt failed; both the error and the retry are waste.
3. **Overwritten writes** — a `write_file` to path X followed by another `write_file` to path X where the second write fully replaces (not extends) the first. The first write was discarded work.
4. **Interruptions** — `isInterruption = true` calls. Intentionally double-counted with Setup Friction: Friction penalizes the *user disruption* (being asked questions), Efficiency penalizes the *wasted call slot* (the agent spent a turn asking instead of making progress). This is not accidental overlap — the same event harms two distinct qualities.

Everything not classified as waste is treated as useful. This intentionally under-counts waste (exploratory reads that turn out to be irrelevant are counted as useful), which is the right default — we'd rather miss subtle waste than penalize legitimate exploration.

**Formula (proposed):**
```
waste_count = count of tool calls matching ≥1 waste category (each call counted at most once)
efficiency (%) = max(0, 100 × (1 - waste_count / total_calls))
```

A single tool call can match multiple waste predicates (e.g., a retry that also errors). To prevent `waste_count` from exceeding `total_calls`, each tool call contributes at most 1 to the count regardless of how many categories it matches. Per-category breakdowns are reported separately in notes for diagnostics.

**Edge case:** When `total_calls == 0`, the formula is undefined. The scorer returns 100 but the process-dimension gate zeroes all process scores for runs with no tool calls (see AGENTS.md Overview), so this never produces a misleading result.

**Score behavior:**
- Next.js with 40 tool calls and 2 errors → 95% (was 25% under old formula)
- Nuxt with 34 calls and 0 waste → 100% (was 29%)
- A flailing agent with 20 calls, 8 errors and 3 retries → 45% (errored calls include retries — 11 waste calls / 20 total)

**v1.1 upgrade path**: Add LLM-as-judge post-hoc classification as a validation layer — run it on 50 traces, compare with heuristic scores, calibrate. If heuristics consistently under-report waste by >15%, switch to hybrid approach.

### Error Recovery — 7%

Provider errors are infrastructure failures (rate limits, timeouts), not agent quality signals. They affect developer experience but the agent can't prevent them. Lower weight than the other process dimensions ensures a flaky API day doesn't tank an otherwise good run, while still penalizing repeated failures that suggest a systemic problem.

**Constant: penalty = 20 per error.** Stricter per-error than Friction's 10-per-error because this dimension only measures errors — it needs to differentiate sharply between 1 transient failure (acceptable) and 5 repeated failures (systemic problem).

### Correctness — 25% (heaviest single dimension)

Correctness is the bottom line — did the generated code actually work? It gets the single largest weight because everything else is secondary if the output doesn't import real packages, call real methods, and wire components correctly.

**L2/L3 exclusion.** Correctness excludes L2 (hallucination) and L3 (security) graders because those failures are already captured in their own dedicated dimensions. Including them in Correctness would double-count: a single hallucinated import would penalize both Correctness and Hallucination, over-weighting that failure relative to its actual severity. With the exclusion, Correctness measures L1 (presence), L4 (structural), L5 (version), and the holistic judge — the dimensions that don't have their own scoring category.

### Hallucination — 15%

Hallucinations are the most dangerous failure mode for developer trust. A wrong import or invented package wastes hours of debugging time because the error messages don't point to the real problem — the dependency doesn't exist. Weighted higher than Security because hallucinations are far more common in practice. L2 graders are scored exclusively here — they are excluded from Correctness to prevent double-counting.

### Docs Quality — 7%

#### Why this dimension exists

When a developer uses an AI agent to integrate Auth0, the agent has two paths to knowledge: its training data, or live documentation. Training data goes stale — a model trained before `@auth0/auth0-nuxt` existed will confidently reach for the Vue SPA SDK instead. Live docs are the ground truth.

This dimension measures not just *whether* an agent fetched documentation, but *how well it used it*. It answers the question Auth0 cares about most: **does investing in better documentation actually change agent behavior and output quality?**

Critically, agents that never fetch docs score 100 — succeeding from training data is a valid strategy and should not be penalized. The dimension only fires when an agent chooses to look something up, and then asks: was that lookup worth it?

#### What "good" looks like

A high-scoring agent fetches documentation from a trusted Auth0 source, gets a successful response, and uses it to write the code correctly the first time — no rewrites after the fetch. A low-scoring agent fetches a wrong URL (or gets a 404), or overwrites files it had already written after looking up the docs.

#### Formula

```
if doc_lookups == 0:
    score = 100                                              # no fetch needed — full marks
else:
    score = sum(points per lookup) / total_lookups
```

Each doc lookup is scored independently out of 100 points across three equal-weight signals:

| Signal | Points | What it means | How detected |
|---|---|---|---|
| URL is a valid Auth0 domain | +34 | Agent went to the right source | URL `startsWith` one of the allowed prefixes (prevents false positives when Auth0 URLs appear as query parameters) |
| Fetch did not error or 404 | +33 | Agent actually got content back | `causedError == false` on the tool call |
| Correctness: no file overwrite after this fetch | +17 | Agent didn't discard its own output after reading docs | No `write_file` to an already-written path between this fetch and the next (or end-of-trace for the final fetch) |
| Correctness: L4 grader pass rate | up to +16 | Docs translated into structurally correct code | `16 × (l4_passed / total_l4)` — scales with fraction of L4 graders that pass |

The last two signals together form a **correctness** measure — did the doc fetch produce correct code? The rewrite sub-signal catches immediate thrashing (agent overwrote its own work); the L4 sub-signal is the direct structural correctness check, scaled proportionally so a partial L4 failure (1 of 3 failing) costs ~5 points rather than the full 16.

The final score is the average across all lookups. An agent that makes one perfect lookup, doesn't rewrite, and passes all L4 graders scores 100.

#### Valid Auth0 doc domains

Any fetch to a URL outside this list scores 0 on the first signal. The check uses `startsWith` (not `contains`) to prevent false positives when Auth0 URLs appear as query parameters in proxy or redirect URLs. The list should be treated as a living allowlist — add entries as new canonical sources emerge:
- `https://auth0.github.io`
- `https://auth0.com/docs`
- `https://auth0.com/blog`
- `https://community.auth0.com`
- `https://npmjs.com/package/@auth0`
- `https://github.com/auth0/`
- `https://github.com/auth0-samples`
- `https://jwt.io`

#### Why this is measurable without an LLM judge

The first three signals are pure trace sequence analysis — they require only the ordered list of tool calls already captured in `session_trace`. The fourth signal (L4 grader pass rate) is already computed as part of the Correctness dimension. No extra LLM calls, no added latency, no additional cost per eval run.

#### What this tells Auth0

A low Docs Quality score on a specific framework is a direct signal: **the documentation for that SDK is not serving agents well.** Either agents aren't finding it, aren't getting useful content from it, or are getting content that doesn't translate into correct code on the first attempt. Each of those failure modes points to a different fix — better URL discoverability, richer content, or clearer code examples with correct structural wiring.


### Security — 10%

Hardcoded secrets are serious but relatively rare in quickstart contexts — most agents know not to commit credentials. Weighted lower than Hallucination because the failure rate is lower, but still significant because a single leaked secret is a real security incident, not just a bad developer experience. L3 graders are scored exclusively here — they are excluded from Correctness to prevent double-counting.

---

## Decisions

### Exclude L2/L3 graders from Correctness (2026-04-20)

**Problem:** L2 (hallucination) and L3 (security) graders were counted in both Correctness and their dedicated dimensions (Hallucination, Security). A single failing L2 grader would penalize two dimensions simultaneously, over-weighting that failure relative to its actual severity.

**Decision:** Correctness now filters out graders with level L2 or L3. Those graders are scored exclusively in their own dimensions. Correctness covers L1 (positive presence), L4 (structural), L5 (version correctness), and the holistic judge.

**Alternatives considered:**
- *Remove Hallucination/Security as separate dimensions and fold into Correctness.* Rejected — dedicated dimensions give clearer signal on specific failure modes and align with principle #3 (every score must point to a fix).
- *Keep double-counting but reduce weights.* Rejected — weight tuning is fragile and obscures what each dimension measures.

### Remove Docs Quality dimension; rebalance process weights (2026-04-21)

**Problem:** Docs Quality was a static 80/100 for every agent run — it measured Auth0's ecosystem posture, not the agent's behavior. A dimension that can't vary per-run gives no signal for which runs are better or worse, violating principle #3 (every score must point to a fix).

**Decision:** Docs Quality (10%) removed. Its weight redistributed across the three highest-signal process dimensions: Setup Friction 15%→14%, Setup Speed 10%→14%, Efficiency 10%→14%, Error Recovery 5%→8%. Total process weight remains 50%. Scorer is now 7 dimensions.

**Alternatives considered:**
- *Make Docs Quality dynamic (per-framework lookup).* Rejected — the per-framework data doesn't exist yet and the static value was masking the problem rather than solving it.
- *Keep Docs Quality at a lower weight (e.g. 5%).* Rejected — a static dimension at any weight still can't differentiate runs, so the weight would be dead weight in the scoring formula.

---

### Add Docs Quality dimension (2026-05-13)

**Problem:** Agents that fetch wrong or hallucinated documentation URLs (e.g. non-existent Auth0 pages, wrong SDK docs) get no penalty under the current scoring model. Conversely, agents that correctly look up real Auth0 docs and use them effectively get no credit. This hides a meaningful behavioral difference — fetching the Nuxt docs vs the Vue SPA docs is the difference between a C and a B on `nuxt_quickstart`.

**Decision:** Add a Docs Quality dimension (7%) scored per-lookup across three trace-derived signals: URL validity, fetch success, and no post-fetch rewrite. Agents that never fetch docs score 100. Weight spread across all four process dimensions: Setup Friction (14% → 12%), Setup Speed (14% → 12%), Efficiency (14% → 12%), Error Recovery (8% → 7%), with Docs Quality taking 7%.

**Alternatives considered:**
- *Per-eval allowlist of expected URLs.* More precise but high maintenance — a global Auth0 domain allowlist captures the same intent with far less overhead.
- *Penalize agents that fetch no docs when the task requires them.* Rejected — we can't reliably know in advance whether a task requires doc lookup. Agents that succeed without docs should be rewarded, not penalized.
- *Use LLM-as-judge to verify doc was applied correctly.* Rejected for v1 — pure trace sequence analysis gives sufficient signal at zero added cost. Can be layered in later if the heuristics prove insufficient.
- *Concentrate cut on one dimension.* Rejected — removing 7% from a single dimension would disproportionately weaken that signal. Spreading across all four process dimensions (−2% each from Friction, Speed, Efficiency; −1% from Error Recovery) keeps the reduction proportional to each dimension's prior weight.

---

### Add L4 correctness sub-signal to Docs Quality (2026-05-19)

**Problem:** The "no file overwrite after fetch" signal was a useful heuristic but incomplete — an agent could avoid rewrites and still produce structurally broken code, scoring full marks on that signal despite the docs having no effect on output correctness.

**Decision:** Split the third signal (33 points) into two proportional sub-signals: no file overwrite (+17) and no L4 grader failures (+16). The rewrite heuristic catches immediate thrashing; L4 pass rate is the direct correctness measure. Together they capture whether the doc fetch translated into correct code. Losing one costs 16–17 points; losing both costs 33. The L4 result is already computed for Correctness, so no added cost.

**Alternatives considered:**
- *Replace file-overwrite entirely with L4.* Rejected — the rewrite signal catches a distinct failure mode (agent discarded its own output) that L4 doesn't capture. Both are worth keeping.
- *Binary L4 sub-signal (all pass = +16, any fail = +0).* Rejected — too harsh when an eval has multiple L4 graders. Proportional scaling (`16 × l4_passed / total_l4`) means one failing L4 out of three costs ~5 points, which is more calibrated.
