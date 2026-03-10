"""
Report generator.

Reads scores-*.json files and produces a single HTML report comparing
results across modes (baseline, skills, agent).

Usage:
    python report.py                        # auto-discovers scores-*.json
    python report.py --input scores-baseline.json scores-skills.json
    python report.py --output my-report.html
"""

import argparse
import json
import glob
import os
from pathlib import Path
from datetime import datetime

FRAMEWORK_ROOT = Path(__file__).parent


def load_scores(paths: list[str]) -> list[dict]:
    results = []
    for path in paths:
        with open(path) as f:
            data = json.load(f)
            results.extend(data)
    return results


def group_by_eval(results: list[dict]) -> dict:
    """{ eval_id: { mode: result } }"""
    grouped: dict = {}
    for r in results:
        eid = r["eval_id"]
        mode = r["mode"]
        if eid not in grouped:
            grouped[eid] = {}
        grouped[eid][mode] = r
    return grouped


def pct(n, total) -> int:
    return round(n / total * 100) if total else 0


def bar(rate: float, width: int = 20) -> str:
    filled = round(rate * width)
    empty  = width - filled
    color  = "#22c55e" if rate == 1.0 else "#f59e0b" if rate >= 0.5 else "#ef4444"
    return (
        f'<span style="font-family:monospace;color:{color}">'
        + "█" * filled + "░" * empty +
        f'</span> {round(rate * 100)}%'
    )


def grade_color(rate: float) -> str:
    if rate == 1.0: return "#22c55e"
    if rate >= 0.75: return "#84cc16"
    if rate >= 0.5:  return "#f59e0b"
    return "#ef4444"


def render_graders(graders: list[dict]) -> str:
    rows = ""
    for g in graders:
        icon  = "✓" if g["passed"] else "✗"
        color = "#22c55e" if g["passed"] else "#ef4444"
        name  = g["name"]
        kind  = g["kind"]
        detail = g.get("detail", "")
        rows += f"""
        <tr>
          <td style="color:{color};font-weight:bold;width:24px">{icon}</td>
          <td><span style="font-size:11px;background:#1e293b;color:#94a3b8;
              padding:1px 6px;border-radius:4px;margin-right:6px">{kind}</span>
              {name}</td>
          <td style="color:#64748b;font-size:12px">{detail}</td>
        </tr>"""
    return f'<table style="width:100%;border-collapse:collapse;font-size:13px">{rows}</table>'


def render_mode_card(mode: str, result: dict) -> str:
    rate    = result["grader_pass_rate"]
    passed  = result["graders_passed"]
    total   = result["graders_total"]
    tokens  = result.get("tokens", 0)
    cost    = result.get("cost_usd", 0)
    wall    = result.get("wall_time", 0)
    color   = grade_color(rate)
    graders_html = render_graders(result["graders"])

    return f"""
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;
                padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;
                  margin-bottom:12px">
        <div>
          <span style="background:#1e293b;color:#94a3b8;padding:3px 10px;
                       border-radius:12px;font-size:12px;font-weight:600;
                       text-transform:uppercase">{mode}</span>
          <span style="margin-left:10px;font-size:13px;color:#64748b">
            {result['model']}
          </span>
        </div>
        <div style="text-align:right">
          <span style="font-size:22px;font-weight:700;color:{color}">
            {passed}/{total}
          </span>
          <span style="font-size:13px;color:#64748b;margin-left:4px">graders</span>
        </div>
      </div>
      <div style="margin-bottom:12px">{bar(rate)}</div>
      {graders_html}
      <div style="margin-top:10px;display:flex;gap:16px;font-size:12px;color:#475569">
        <span>⏱ {wall:.1f}s</span>
        <span>🔤 {tokens:,} tokens</span>
        <span>💰 ${cost:.4f}</span>
      </div>
    </div>"""


def render_eval_section(eval_id: str, modes: dict) -> str:
    mode_cards = "".join(render_mode_card(m, r) for m, r in sorted(modes.items()))

    # Summary row across modes
    summary_cells = ""
    for mode in ["baseline", "skills", "agent"]:
        if mode in modes:
            r    = modes[mode]
            rate = r["grader_pass_rate"]
            col  = grade_color(rate)
            summary_cells += f"""
            <div style="text-align:center">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;
                          letter-spacing:.05em">{mode}</div>
              <div style="font-size:20px;font-weight:700;color:{col}">
                {round(rate*100)}%
              </div>
            </div>"""

    return f"""
    <div style="margin-bottom:32px">
      <div style="display:flex;justify-content:space-between;align-items:center;
                  margin-bottom:12px">
        <h2 style="margin:0;font-size:18px;color:#f1f5f9">{eval_id}</h2>
        <div style="display:flex;gap:24px">{summary_cells}</div>
      </div>
      {mode_cards}
    </div>"""


def render_html(results: list[dict], generated_at: str) -> str:
    grouped = group_by_eval(results)
    eval_sections = "".join(render_eval_section(eid, modes)
                            for eid, modes in sorted(grouped.items()))

    # Top-level summary
    total_runs   = len(results)
    total_cost   = sum(r.get("cost_usd", 0) for r in results)
    modes_run    = sorted(set(r["mode"] for r in results))
    models_run   = sorted(set(r["model"] for r in results))

    mode_tags = "".join(
        f'<span style="background:#1e293b;color:#94a3b8;padding:3px 10px;'
        f'border-radius:12px;font-size:12px;margin-right:6px">{m}</span>'
        for m in modes_run
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auth0 SDK Eval Report</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: #020817;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 32px;
      max-width: 900px;
      margin: 0 auto;
    }}
    a {{ color: #60a5fa; }}
  </style>
</head>
<body>
  <div style="margin-bottom:32px;border-bottom:1px solid #1e293b;padding-bottom:24px">
    <h1 style="font-size:26px;font-weight:700;color:#f8fafc;margin-bottom:6px">
      Auth0 SDK — Eval Report
    </h1>
    <div style="color:#64748b;font-size:13px;margin-bottom:12px">{generated_at}</div>
    <div style="display:flex;gap:24px;font-size:13px;color:#94a3b8">
      <span><strong style="color:#e2e8f0">{total_runs}</strong> runs</span>
      <span><strong style="color:#e2e8f0">{len(grouped)}</strong> evals</span>
      <span><strong style="color:#e2e8f0">{", ".join(models_run)}</strong></span>
      <span>total cost <strong style="color:#e2e8f0">${total_cost:.4f}</strong></span>
    </div>
    <div style="margin-top:10px">{mode_tags}</div>
  </div>

  {eval_sections}

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #1e293b;
              font-size:12px;color:#475569">
    Generated by auth0-evals
  </div>
</body>
</html>"""


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
