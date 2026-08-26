# Scoring Methodology — Decision Rationale

## Philosophy

- A published score must match what actually happens for the developer, or it's worthless.
- Prompts: 25–90 words, realistic. Never a step-by-step recipe.
- Agents: Claude Code, Copilot, Gemini CLI. Real workspace, real shell. No synthetic harness.
- The real comparison is agent-with-tools vs. agent-with-Auth0's-tools — that's what a developer actually runs. Zero-tool baseline (raw LLM, no agentic loop) isn't a real workflow for an agentic coding task; it's an internal signal for whether training data alone knows Auth0, not the headline number. 

## Grader levels

- **L1–L3: all configs, including baseline.** Training-data knowledge — correct imports, no invented packages, no hardcoded secrets.
- **L4: agent configs only.** Structural correctness needs a file tree. Baseline has none.
- **L5: agent+MCP only.** Penalizing a deprecated pattern is only fair if the model had current docs.

## Process / Output — 50/50

Process counts even when the output is correct. 10 interruptions and 50 retries to a correct result is still a bad experience.

- Process (50%): Setup Friction 12 + Setup Speed 12 + Efficiency 12 + Error Recovery 7 + Docs Quality 7.
- Output (50%): Correctness 25 + Hallucination 15 + Security 10.

## Grade thresholds

| Grade | Min | Meaning |
|---|---|---|
| A | 90 | Production-ready |
| B | 75 | Sound, notable gaps |
| C | 60 | Usable, needed cleanup |
| D | 40 | Major failures |
| F | <40 | Not useful |

Bands are uneven on purpose: 15 points per band A→C, 20 for D, 40 for F.

## Dimension applicability

**Problem:** a CLI-only eval registers no L2/L3 grader (no files to check). `scoreFromGraders` returns 100 anyway, indistinguishable from an eval that ran the checks and passed. `scoreCorrectness` has the mirror bug — an empty relevant-grader set scores 0, not "no signal."

**Rule:** a dimension is applicable only if the eval registers a grader for it, decided at load time. Inapplicable → excluded from the weighted sum, remaining weights renormalize to 1.0 (drop Hallucination+Security → Correctness's 25% becomes ~33%). Report shows N/A, not a number.

**Exceptions (deliberate, not missing evidence, leave as-is):** Docs Quality's "no lookups → 100." A baseline run's missing L4/L5 (mode filter, not the eval's own definition).

General rule — covers any dimension, any future eval shape (Terraform-only, MCP-reply-only), not a CLI special case.

## Dimension weights

**Setup Friction — 12%.** Interruptions (`ask_user`) are the biggest friction point. Penalty 14/interruption (7 = zero). Provider errors: 10/error (not the agent's fault, still counts).

**Setup Speed — 12%.** Active tool time, not wall time (wall time carries network noise). Ideal 60s. Degrades 0.4/excess second, ceiling ~310s.

**Efficiency — 12%.** Waste-detection, not call-counting — the old count-based formula punished complexity (a legitimate 40-call integration scored the same as a flailing one). Waste = duplicate read, errored/retried call, overwritten write, or interruption (double-counted with Friction on purpose: one penalizes disruption, one the wasted slot).

Zero tool calls → 100 (applies to both SDK and CLI modes; a run with no tools is scored separately by the zero-guard in `scoreEfficiency`).

```
efficiency % = max(0, 100 × (1 − waste_count / total_calls))
```

Each call counts as waste once, regardless of how many categories it matches.

*CLI-profile variant.* No files → duplicate-read/overwritten-write correctly contribute zero. Real gap: errored/retry detection only catches a repeated *identical* command, not a command that exits 0 but hits the wrong resource, then gets corrected with different arguments. For `cli-only` evals, measure precision against the eval's declared target operation instead:

```
precision % = 100 × (1 − corrective_attempts / attempts_at_target_operation)
```

Discovery calls (`list`, `show`, `--help`) excluded — Setup Speed/Friction already score those.

**Error Recovery — 7%.** Provider errors are infrastructure, not agent quality. Penalty 20/error — steeper than Friction's 10 because this dimension's only job is separating 1 transient failure from 5 systemic ones.

**Correctness — 25%.** Excludes L2/L3. Three guiding questions, in order:
1. Does it exist? (L1 — right import, component, hook, config key present.)
2. Is it wired right? (L4 — provider wraps the right tree, loading state checked before render, handlers actually connected to UI.)
3. Is it current? (L5, agent+MCP only — not a pattern the SDK has since replaced.)

A holistic judge closes out whatever those three miss — the one subjective check in the set.

**Hallucination — 15%.** L2 only. Two guiding principles:
1. Invented — the package, method, or field doesn't exist at all.
2. Real but misapplied — it exists, just wrong for this context (server SDK used in a SPA; `client_secret` set on a public client).

Boundary vs. L5: if good training data alone should know better, it's here. If it needs current docs to know something's deprecated, it's L5.

**Security — 10%.** L3 only. Two guiding principles:
1. Hardcoded credentials in source — secrets, domain, client ID as literal strings, not config.
2. Hand-rolled token storage — `localStorage`/`sessionStorage` instead of the SDK's own handling.

Scope stops there by design. Insecure default config isn't covered yet — a known gap, not yet widened.

**Docs Quality — 7%.** Measures whether a fetch helped, not just whether one happened. No fetch → 100 (training data was enough).

```
score = 100                         if doc_lookups == 0
score = avg(per-lookup points)       otherwise
```

Per lookup, out of 100: valid Auth0 domain +34 · fetch didn't error/404 +33 · no overwrite after fetch +17 · L4 pass rate +16 (scaled, already computed for Correctness — no added cost).

Allowlist: `auth0.github.io`, `auth0.com/docs`, `auth0.com/blog`, `community.auth0.com`, `npmjs.com/package/@auth0`, `github.com/auth0/`, `github.com/auth0-samples`, `jwt.io`. Extend as sources emerge.

A low score points at one of three fixes: findability, content quality, or code correctness.

## Weight changes require a sensitivity check

Every past reshuffle was justified by the one case that broke, never checked against evals that weren't. Before merge: re-score existing results under old vs. new weights, report which evals change letter grade. No grade change = cosmetic, say so. Every result is stamped with the weight-vector version that scored it.