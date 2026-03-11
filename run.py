"""
Consolidated eval runner.

Follows the architecture from the reference TypeScript framework:
  - Central registry loaded from config/evaluations.py
  - Self-contained evals in evals/<id>/ (PROMPT.md + graders.py + scaffold/)
  - Three execution modes: agent (agentic loop), baseline (no tools), skills
  - Parallel execution across eval × model pairs

Usage:
    python run.py [options]

    API key is loaded from .env automatically. Copy .env.example to .env
    and fill in your ATKO_API_KEY.

Options:
    --eval      Eval ID to run (default: all). Can be repeated.
    --model     Model(s) to run (default: gpt-4o-mini). Can be repeated.
    --mode      Execution mode: agent | baseline | skills (default: baseline)
    --workers   Parallel workers (default: 4)
    --output    Output JSON path (default: scores-<mode>.json)
    --keep-workspace   (agent mode) Keep temp workspace after run
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

FRAMEWORK_ROOT = Path(__file__).parent


def _load_env(path: Path) -> None:
    """Load key=value pairs from a .env file into os.environ.
    Skips comments and blank lines. Does not override existing env vars."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env(FRAMEWORK_ROOT / ".env")

# Make agent_eval importable
sys.path.insert(0, str(FRAMEWORK_ROOT))

from config.evaluations import EVALUATIONS
from runners.loader import load_eval, EvalDefinition
from agent_eval.graders import run_graders


# ── Per-job execution ─────────────────────────────────────────────────────────

def run_job(
    eval_config: dict,
    model: str,
    mode: str,
    api_key: str,
    keep_workspace: bool = False,
) -> dict:
    """
    Execute one eval × model pair in the given mode.
    Returns a result dict suitable for JSON serialisation.
    """
    eval_def = load_eval(eval_config, FRAMEWORK_ROOT)
    print(f"  [{mode}] {eval_def.id} / {model}")

    if mode == "baseline":
        from runners.baseline import run_baseline
        result = run_baseline(api_key=api_key, model=model, eval_def=eval_def)
        grader_results = _grade_text(eval_def, result.response_text, api_key)
        return _serialise_simple(eval_def, result, grader_results)

    elif mode == "skills":
        from runners.skills import run_skills
        result = run_skills(
            api_key=api_key,
            model=model,
            eval_def=eval_def,
        )
        grader_results = _grade_text(eval_def, result.response_text, api_key)
        return _serialise_simple(eval_def, result, grader_results)

    elif mode == "agent":
        return _run_agent_job(eval_def, model, api_key, keep_workspace)

    else:
        raise ValueError(f"Unknown mode: {mode}")


def _grade_text(eval_def: EvalDefinition, text: str, api_key: str) -> list:
    """Run graders against a single text blob (for baseline / skills modes)."""
    import tempfile
    from pathlib import Path as P

    with tempfile.TemporaryDirectory() as tmp:
        # Write the LLM response as a virtual file so the existing
        # file-scanning graders can find patterns in it
        response_file = P(tmp) / "llm_response.txt"
        response_file.write_text(text)
        return run_graders(eval_def.graders, tmp, api_key)


def _run_agent_job(eval_def: EvalDefinition, model: str, api_key: str, keep_workspace: bool) -> dict:
    """Run the full agentic loop for one eval × model pair."""
    from agent_eval.agent import RunRecord, run_agent, setup_workspace, cleanup_workspace
    from agent_eval.scorer import score

    workspace = setup_workspace(eval_def.scaffold)
    try:
        # Adapt EvalDefinition to the interface run_agent expects
        task_adapter = _EvalAdapter(eval_def)
        record: RunRecord = run_agent(
            api_key=api_key,
            model=model,
            task=task_adapter,
            workspace=workspace,
        )

        grader_results = []
        if eval_def.graders:
            grader_results = run_graders(eval_def.graders, workspace, api_key)

        scored = score(record)
        scored.grader_results = grader_results

        return {
            "eval_id":       eval_def.id,
            "model":         model,
            "mode":          "agent",
            "session_id":    record.session_id,
            "status":        record.status,
            "overall_score": scored.overall_score,
            "overall_grade": scored.overall_grade,
            "grader_pass_rate": scored.grader_pass_rate,
            "wall_time":     record.wall_time,
            "active_time":   record.active_time,
            "tool_calls":    len(record.tool_calls),
            "interruptions": record.interruption_count,
            "tokens":        record.input_tokens + record.output_tokens,
            "cost_usd":      record.cost_usd,
            "dimensions": [
                {"name": d.name, "score": d.raw_score, "grade": d.grade}
                for d in scored.dimensions
            ],
            "graders": [
                {"name": gr.name, "kind": gr.kind, "passed": gr.passed}
                for gr in grader_results
            ],
        }
    finally:
        if not keep_workspace:
            cleanup_workspace(workspace)


class _EvalAdapter:
    """Adapts EvalDefinition to the attribute interface run_agent() expects."""
    def __init__(self, eval_def: EvalDefinition):
        self.name          = eval_def.id
        self.system_prompt = eval_def.system_prompt
        self.user_prompt   = eval_def.user_prompt
        self.scaffold      = eval_def.scaffold
        self.graders       = eval_def.graders
        self.metadata      = eval_def.metadata


def _serialise_simple(eval_def, result, grader_results) -> dict:
    passed = sum(1 for r in grader_results if r.passed)
    total  = len(grader_results)
    rate   = passed / total if total else 1.0
    return {
        "eval_id":          eval_def.id,
        "model":            result.model,
        "mode":             result.mode,
        "session_id":       result.session_id,
        "status":           result.status,
        "grader_pass_rate": rate,
        "graders_passed":   passed,
        "graders_total":    total,
        "wall_time":        result.wall_time,
        "tokens":           result.input_tokens + result.output_tokens,
        "cost_usd":         result.cost_usd,
        "error":            getattr(result, "error", ""),
        "graders": [
            {"name": gr.name, "kind": gr.kind, "passed": gr.passed, "detail": gr.detail}
            for gr in grader_results
        ],
    }


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Auth0 SDK Eval Runner")
    parser.add_argument("--eval",    action="append", dest="evals",
                        help="Eval ID(s) to run (default: all)")
    parser.add_argument("--model",   action="append", dest="models",
                        default=None, help="Model(s) to run (default: gpt-4o-mini)")
    parser.add_argument("--mode",    default="baseline",
                        choices=["agent", "baseline", "skills"],
                        help="Execution mode (default: baseline)")
    parser.add_argument("--workers", type=int, default=4,
                        help="Parallel workers (default: 4)")
    parser.add_argument("--output",  default=None,
                        help="JSON output path (default: scores-<mode>.json)")
    parser.add_argument("--keep-workspace", action="store_true",
                        help="(agent mode) Keep temp workspace after run")
    args = parser.parse_args()

    api_key = os.environ.get("ATKO_API_KEY")
    if not api_key:
        raise SystemExit("Error: ATKO_API_KEY environment variable not set.")

    models = args.models or ["gpt-4o-mini"]

    # Filter evals by --eval flag (default: all)
    registry = EVALUATIONS
    if args.evals:
        registry = [e for e in EVALUATIONS if e["id"] in args.evals]
        unknown  = set(args.evals) - {e["id"] for e in EVALUATIONS}
        if unknown:
            raise SystemExit(f"Unknown eval ID(s): {unknown}. "
                             f"Available: {[e['id'] for e in EVALUATIONS]}")

    # Build job list: eval × model
    jobs = [(eval_cfg, model) for eval_cfg in registry for model in models]

    print(f"\nRunning {len(jobs)} job(s)  mode={args.mode}  workers={args.workers}")
    print(f"Evals : {[j[0]['id'] for j in jobs]}")
    print(f"Models: {models}\n")

    results: list[dict] = []
    t_start = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(
                run_job,
                eval_cfg, model, args.mode, api_key, args.keep_workspace,
            ): (eval_cfg["id"], model)
            for eval_cfg, model in jobs
        }

        for future in as_completed(futures):
            eval_id, model = futures[future]
            try:
                result = future.result()
                results.append(result)
                _print_result(result)
            except Exception as exc:
                print(f"  [ERROR] {eval_id}/{model}: {exc}")
                results.append({
                    "eval_id": eval_id,
                    "model": model,
                    "mode": args.mode,
                    "status": "error",
                    "error": str(exc),
                })

    elapsed = time.time() - t_start
    _print_summary(results, elapsed)

    # Save results to JSON
    output_path = args.output or f"scores-{args.mode}.json"
    output_path = str(FRAMEWORK_ROOT / output_path)
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n[Output] Results saved to: {output_path}")


# ── Summary helpers ───────────────────────────────────────────────────────────

def _print_result(r: dict) -> None:
    mode = r.get("mode", "?")
    if mode == "agent":
        grade = r.get("overall_grade", "?")
        score = r.get("overall_score", 0)
        rate  = r.get("grader_pass_rate", 0)
        print(f"  ✓ [{r['eval_id']}] {r['model']}  grade={grade} ({score:.0f})  "
              f"graders={rate*100:.0f}%  ${r.get('cost_usd', 0):.4f}")
    else:
        passed = r.get("graders_passed", "?")
        total  = r.get("graders_total", "?")
        rate   = r.get("grader_pass_rate", 0)
        print(f"  ✓ [{r['eval_id']}] {r['model']}  graders={passed}/{total} "
              f"({rate*100:.0f}%)  ${r.get('cost_usd', 0):.4f}")


def _print_summary(results: list[dict], elapsed: float) -> None:
    print("\n" + "=" * 60)
    print(f"  Summary — {len(results)} run(s)  ({elapsed:.1f}s total)")
    print("=" * 60)
    succeeded = [r for r in results if r.get("status") not in ("error", "failure")]
    failed    = [r for r in results if r.get("status") in ("error", "failure")]
    print(f"  Passed : {len(succeeded)}")
    print(f"  Failed : {len(failed)}")
    total_cost = sum(r.get("cost_usd", 0) for r in results)
    print(f"  Cost   : ${total_cost:.4f}")
    if failed:
        print("\n  Failures:")
        for r in failed:
            print(f"    {r.get('eval_id')}/{r.get('model')}: {r.get('error','')}")
    print("=" * 60)


if __name__ == "__main__":
    main()
