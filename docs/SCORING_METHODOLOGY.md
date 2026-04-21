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

### Setup Friction — 15% (heaviest process weight)

Interruptions are the single biggest friction point in agent-assisted development. If the agent stops to ask "what's your domain?" or "what framework do you want?", the entire value prop of autonomous setup breaks. A developer who has to answer 5 questions might as well have read the quickstart docs.

**Constant: interruption penalty = 14.** Calibrated so 7 interruptions = score 0. A quickstart that asks 7 questions has failed its purpose — the developer would have been faster reading the docs.

**Constant: provider error penalty = 10 (less than interruptions).** Provider errors are infrastructure problems, not agent behavior — they're frustrating but not the agent's fault. Still penalized because they affect the developer experience regardless of cause.

### Setup Speed — 10%

Speed matters but less than friction — a slow clean run beats a fast messy one. And speed is partially outside the agent's control (API latency, model inference time).

**Why active time, not wall time?** Wall time includes network latency, queuing, and parallelism effects that vary by infrastructure. Active tool time isolates what the agent actually spent doing work, making scores comparable across different environments.

**Constant: ideal = 60s.** A well-executed quickstart needs ~10 tool calls (read scaffold, write a few files, install deps, maybe run a build). At ~6s per tool call average, 60s is a clean run. Observed top-performing runs cluster around 40–80s active time.

**Constant: degradation rate = 0.4 (ceiling at 310s).** 5+ minutes of active tool execution for a quickstart means the agent is thrashing — retrying failed commands, reading unnecessary files, or going in circles.

### Efficiency — 10%

Tool call count correlates with cost and complexity, but it's a blunt instrument — some frameworks legitimately need more steps than others. Equal weight with Speed so neither dominates process scoring alone.

**Constant: ideal = 10 calls.** A focused quickstart implementation: read 2–3 scaffold files, write 3–4 files, run 1–2 commands, finish. More than 10 suggests the agent explored unnecessarily, retried operations, or wrote files it later overwrote. The curve is intentionally steep — doubling the ideal call count halves the score.

### Error Recovery — 5% (lowest process weight)

Provider errors are infrastructure failures (rate limits, timeouts), not agent quality signals. They affect developer experience but the agent can't prevent them. Low weight ensures a flaky API day doesn't tank an otherwise good run, while still penalizing repeated failures that suggest a systemic problem.

**Constant: penalty = 20 per error.** Stricter per-error than Friction's 10-per-error because this dimension only measures errors — it needs to differentiate sharply between 1 transient failure (acceptable) and 5 repeated failures (systemic problem).

### Docs Quality — 10%

This dimension measures Auth0's ecosystem investment, not the agent's behavior. It's included because discoverability directly affects whether agents can find the right docs — but it's weighted modestly because it doesn't vary per-run today.

**Why keep a static dimension?** It tracks Auth0's AI discoverability posture as a leading indicator. When `openapi_spec` ships, the score goes to 100. When a new discoverability channel matters (e.g., Cursor rules), it can be added.

### Correctness — 25% (heaviest single dimension)

Correctness is the bottom line — did the generated code actually work? It gets the single largest weight because everything else is secondary if the output doesn't import real packages, call real methods, and wire components correctly.

**L2/L3 exclusion.** Correctness excludes L2 (hallucination) and L3 (security) graders because those failures are already captured in their own dedicated dimensions. Including them in Correctness would double-count: a single hallucinated import would penalize both Correctness and Hallucination, over-weighting that failure relative to its actual severity. With the exclusion, Correctness measures L1 (presence), L4 (structural), L5 (version), and the holistic judge — the dimensions that don't have their own scoring category.

### Hallucination — 15%

Hallucinations are the most dangerous failure mode for developer trust. A wrong import or invented package wastes hours of debugging time because the error messages don't point to the real problem — the dependency doesn't exist. Weighted higher than Security because hallucinations are far more common in practice. L2 graders are scored exclusively here — they are excluded from Correctness to prevent double-counting.

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
