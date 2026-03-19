"""
Report generator.

Reads scores-*.json files and produces a single HTML report comparing
results across modes and models in a summary table, with detailed grader
breakdowns below.

Usage:
    python report.py                        # auto-discovers scores-*.json
    python report.py --input scores-baseline.json scores-skills.json
    python report.py --output my-report.html
"""

import argparse
import json
import glob
from pathlib import Path
from datetime import datetime
from jinja2 import Environment, FileSystemLoader, select_autoescape

FRAMEWORK_ROOT = Path(__file__).parent

MODES = ["baseline", "agent", "agent+skills"]


def load_scores(paths: list[str]) -> list[dict]:
    results = []
    for path in paths:
        with open(path) as f:
            data = json.load(f)
            results.extend(data)
    return results


def group_results(results: list[dict]) -> dict:
    """{ eval_id: { (model, mode): result } }"""
    grouped: dict = {}
    for r in results:
        eid = r["eval_id"]
        key = (r["model"], r["mode"])
        if eid not in grouped:
            grouped[eid] = {}
        grouped[eid][key] = r
    return grouped


def grade_color(rate: float) -> str:
    if rate == 1.0:  return "#22c55e"
    if rate >= 0.75: return "#84cc16"
    if rate >= 0.5:  return "#f59e0b"
    return "#ef4444"


def grade_class(rate: float) -> str:
    if rate == 1.0:  return "rate-excellent"
    if rate >= 0.75: return "rate-good"
    if rate >= 0.5:  return "rate-fair"
    return "rate-poor"


def render_html(results: list[dict], generated_at: str) -> str:
    grouped_tuples = group_results(results)

    # Convert tuple keys to "model|mode" string keys for Jinja2 compatibility
    grouped: dict = {}
    for eval_id, runs in grouped_tuples.items():
        grouped[eval_id] = {f"{model}|{mode}": result for (model, mode), result in runs.items()}

    all_keys = sorted(
        set(k for ev in grouped_tuples.values() for k in ev.keys()),
        key=lambda k: (k[0], MODES.index(k[1]) if k[1] in MODES else 99),
    )

    total_runs = len(results)
    total_cost = sum(r.get("cost_usd", 0) for r in results)
    models_run = sorted(set(r["model"] for r in results))
    modes_run  = sorted(set(r["mode"]  for r in results))

    def sort_result_keys(keys):
        """Sort (model, mode) string-key pairs: baseline→skills→agent, then model."""
        def parse(k):
            model, mode = k.split("|", 1)
            return (MODES.index(mode) if mode in MODES else 99, model)
        return sorted(keys, key=parse)

    env = Environment(
        loader=FileSystemLoader(str(FRAMEWORK_ROOT / "templates")),
        autoescape=select_autoescape(["html", "j2"]),
    )
    env.globals["grade_color"] = grade_color
    env.globals["grade_class"] = grade_class
    env.filters["sort_result_keys"] = sort_result_keys

    template = env.get_template("report.html.j2")
    return template.render(
        grouped=grouped,
        all_keys=all_keys,
        total_runs=total_runs,
        total_cost=total_cost,
        models_run=models_run,
        modes_run=modes_run,
        generated_at=generated_at,
        MODES=MODES,
    )


def main():
    parser = argparse.ArgumentParser(description="Generate eval HTML report")
    parser.add_argument("--input",  nargs="+", default=None,
                        help="Score JSON files (default: auto-discover scores-*.json)")
    parser.add_argument("--output", default="report.html",
                        help="Output HTML path (default: report.html)")
    args = parser.parse_args()

    input_files = args.input or sorted(glob.glob(str(FRAMEWORK_ROOT / "scores-*.json")))
    if not input_files:
        raise SystemExit("No scores-*.json files found. Run `python run.py` first.")

    print(f"Loading: {input_files}")
    results = load_scores(input_files)
    print(f"  {len(results)} result(s) across {len(set(r['eval_id'] for r in results))} eval(s)")

    html = render_html(results, generated_at=datetime.now().strftime("%Y-%m-%d %H:%M"))
    output = str(FRAMEWORK_ROOT / args.output)
    Path(output).write_text(html)
    print(f"Report saved to: {output}")


if __name__ == "__main__":
    main()
