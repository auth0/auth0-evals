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

FRAMEWORK_ROOT = Path(__file__).parent

MODES = ["baseline", "skills", "agent"]


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


def pct_cell(rate: float) -> str:
    color = grade_color(rate)
    p = round(rate * 100)
    return (
        f'<td style="text-align:center;padding:10px 14px">'
        f'<span style="font-size:15px;font-weight:700;color:{color}">{p}%</span>'
        f'</td>'
    )


def empty_cell() -> str:
    return '<td style="text-align:center;padding:10px 14px;color:#334155">—</td>'


def render_summary_table(grouped: dict, columns: list[tuple]) -> str:
    # Header
    header_cells = '<th style="text-align:left;padding:10px 14px;color:#94a3b8;font-weight:600;font-size:13px">Eval</th>'
    for model, mode in columns:
        header_cells += (
            f'<th style="text-align:center;padding:10px 14px;min-width:120px">'
            f'<div style="color:#94a3b8;font-size:11px;text-transform:uppercase;'
            f'letter-spacing:.05em;font-weight:600">{mode}</div>'
            f'<div style="color:#cbd5e1;font-size:12px;margin-top:2px">{model}</div>'
            f'</th>'
        )

    rows_html = ""
    for eval_id in sorted(grouped):
        results_for_eval = grouped[eval_id]
        row = (
            f'<tr style="border-top:1px solid #1e293b">'
            f'<td style="padding:10px 14px;font-size:13px;color:#e2e8f0;'
            f'font-family:monospace">{eval_id}</td>'
        )
        for col_key in columns:
            if col_key in results_for_eval and results_for_eval[col_key].get("grader_pass_rate") is not None:
                rate = results_for_eval[col_key]["grader_pass_rate"]
                row += pct_cell(rate)
            else:
                row += empty_cell()
        row += "</tr>"
        rows_html += row

    return f"""
    <div style="overflow-x:auto;margin-bottom:40px">
      <table style="width:100%;border-collapse:collapse;background:#0f172a;
                    border:1px solid #1e293b;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#1e293b">{header_cells}</tr>
        </thead>
        <tbody>{rows_html}</tbody>
      </table>
    </div>"""


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
          <td style="color:{color};font-weight:bold;width:24px;padding:4px 0">{icon}</td>
          <td style="padding:4px 8px">
            <span style="font-size:11px;background:#1e293b;color:#94a3b8;
                padding:1px 6px;border-radius:4px;margin-right:6px">{kind}</span>
            {name}
          </td>
          <td style="color:#64748b;font-size:12px;padding:4px 0">{detail}</td>
        </tr>"""
    return f'<table style="width:100%;border-collapse:collapse;font-size:13px">{rows}</table>'


def render_score_breakdown(dimensions: list[dict], overall_score: float, overall_grade: str) -> str:
    """Render the 8-dimension score computation breakdown with process/output grouping."""
    
    # Group dimensions into process (first 5) and output (last 3)
    process_dims = dimensions[:5] if len(dimensions) >= 5 else dimensions
    output_dims = dimensions[5:8] if len(dimensions) >= 8 else []
    
    def render_group(dims, title):
        rows = ""
        for dim in dims:
            name = dim.get("name", "")
            score = dim.get("score", 0)
            weight = dim.get("weight", 0.0)
            weighted = dim.get("weighted", score * weight)
            grade = dim.get("grade", "")
            grade_color = {"A": "#22c55e", "B": "#84cc16", "C": "#f59e0b", "D": "#ef4444", "F": "#ef4444"}.get(grade, "#64748b")
            
            rows += f"""
            <tr>
              <td style="padding:6px 0;color:#cbd5e1;font-size:13px">{name}</td>
              <td style="padding:6px 8px;text-align:right;font-family:monospace;color:#e2e8f0">{score:.1f}</td>
              <td style="padding:6px 8px;text-align:center;color:#64748b;font-size:12px">× {weight:.2f}</td>
              <td style="padding:6px 8px;text-align:right;font-family:monospace;color:#94a3b8">= {weighted:.2f}</td>
              <td style="padding:6px 8px;text-align:center">
                <span style="background:{grade_color};color:#0f172a;padding:2px 8px;border-radius:4px;
                             font-size:11px;font-weight:700">{grade}</span>
              </td>
            </tr>"""
        
        return f"""
        <tr>
          <td colspan="5" style="padding:8px 0 4px 0;color:#94a3b8;font-size:11px;
                                 text-transform:uppercase;letter-spacing:.05em;font-weight:600">
            {title}
          </td>
        </tr>
        {rows}"""
    
    process_html = render_group(process_dims, "Process Dimensions (50%)")
    output_html = render_group(output_dims, "Output Dimensions (50%)")
    
    overall_color = {"A": "#22c55e", "B": "#84cc16", "C": "#f59e0b", "D": "#ef4444", "F": "#ef4444"}.get(overall_grade, "#64748b")
    
    return f"""
    <div style="background:#1e293b;border-radius:6px;padding:12px;margin:12px 0">
      <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.05em;
                  margin-bottom:8px;font-weight:600">Score Computation</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        {process_html}
        {output_html}
        <tr style="border-top:1px solid #334155;margin-top:4px">
          <td style="padding:8px 0 4px 0;color:#e2e8f0;font-weight:600">Weighted Total</td>
          <td colspan="3" style="padding:8px 8px 4px 8px;text-align:right;font-family:monospace;
                                 color:#e2e8f0;font-size:16px;font-weight:700">{overall_score:.1f} / 100</td>
          <td style="padding:8px 8px 4px 8px;text-align:center">
            <span style="background:{overall_color};color:#0f172a;padding:3px 12px;border-radius:4px;
                         font-size:14px;font-weight:700">{overall_grade}</span>
          </td>
        </tr>
      </table>
      <div style="color:#64748b;font-size:11px;margin-top:8px;font-family:monospace">
        Process (50%): friction×15% + speed×10% + efficiency×10% + errors×5% + docs×10%<br>
        Output (50%): correctness×25% + hallucination×15% + security×10%
      </div>
    </div>"""


def render_detail_card(model: str, mode: str, result: dict) -> str:
    graders_list = result.get("graders", [])
    passed = result.get("graders_passed", sum(1 for g in graders_list if g.get("passed")))
    total  = result.get("graders_total", len(graders_list))
    rate   = result.get("grader_pass_rate", (passed / total if total else 0))
    tokens = result.get("tokens", 0)
    cost   = result.get("cost_usd", 0)
    wall   = result.get("wall_time", 0)
    color  = grade_color(rate)
    
    # Check for dimension scores (agent mode)
    dimensions = result.get("dimensions", [])
    overall_score = result.get("overall_score")
    overall_grade = result.get("overall_grade")
    score_breakdown_html = ""
    if dimensions and overall_score is not None:
        score_breakdown_html = render_score_breakdown(dimensions, overall_score, overall_grade)
    
    if result.get("status") == "error":
        error_msg = result.get("error", "Unknown error")[:200]
        return f"""
    <div style="background:#0f172a;border:1px solid #7f1d1d;border-radius:8px;
                padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="background:#1e293b;color:#94a3b8;padding:3px 10px;
                       border-radius:12px;font-size:12px;font-weight:600;
                       text-transform:uppercase">{mode}</span>
          <span style="margin-left:10px;font-size:13px;color:#64748b">{model}</span>
        </div>
        <span style="color:#ef4444;font-size:13px;font-weight:600">ERROR</span>
      </div>
      <div style="margin-top:10px;font-size:12px;color:#ef4444;font-family:monospace">{error_msg}</div>
    </div>"""
    graders_html = render_graders(graders_list)

    filled = round(rate * 20)
    bar_color = color
    bar = (
        f'<span style="font-family:monospace;color:{bar_color}">'
        + "█" * filled + "░" * (20 - filled) +
        f'</span> {round(rate * 100)}%'
    )

    return f"""
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;
                padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;
                  margin-bottom:12px">
        <div>
          <span style="background:#1e293b;color:#94a3b8;padding:3px 10px;
                       border-radius:12px;font-size:12px;font-weight:600;
                       text-transform:uppercase">{mode}</span>
          <span style="margin-left:10px;font-size:13px;color:#64748b">{model}</span>
        </div>
        <div style="text-align:right">
          <span style="font-size:22px;font-weight:700;color:{color}">{passed}/{total}</span>
          <span style="font-size:13px;color:#64748b;margin-left:4px">graders</span>
        </div>
      </div>
      <div style="margin-bottom:12px">{bar}</div>
      {score_breakdown_html}
      {graders_html}
      <div style="margin-top:10px;display:flex;gap:16px;font-size:12px;color:#475569">
        <span>⏱ {wall:.1f}s</span>
        <span>🔤 {tokens:,} tokens</span>
        <span>💰 ${cost:.4f}</span>
      </div>
    </div>"""


def render_detail_section(eval_id: str, results_for_eval: dict) -> str:
    # Sort cards: baseline → skills → agent, then by model name
    sorted_keys = sorted(
        results_for_eval.keys(),
        key=lambda k: (MODES.index(k[1]) if k[1] in MODES else 99, k[0])
    )
    cards = "".join(render_detail_card(model, mode, results_for_eval[(model, mode)])
                    for model, mode in sorted_keys)

    return f"""
    <div style="margin-bottom:36px">
      <h2 style="font-size:16px;color:#f1f5f9;font-family:monospace;
                 margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #1e293b">
        {eval_id}
      </h2>
      {cards}
    </div>"""


def render_html(results: list[dict], generated_at: str) -> str:
    grouped  = group_results(results)
    all_keys = sorted(set(k for ev in grouped.values() for k in ev.keys()),
                      key=lambda k: (k[0], MODES.index(k[1]) if k[1] in MODES else 99))

    summary_table = render_summary_table(grouped, all_keys)
    detail_sections = "".join(render_detail_section(eid, grouped[eid])
                               for eid in sorted(grouped))

    total_runs  = len(results)
    total_cost  = sum(r.get("cost_usd", 0) for r in results)
    models_run  = sorted(set(r["model"] for r in results))
    modes_run   = sorted(set(r["mode"] for r in results))

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
      max-width: 1000px;
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
    <div style="display:flex;gap:24px;font-size:13px;color:#94a3b8;margin-bottom:10px">
      <span><strong style="color:#e2e8f0">{total_runs}</strong> runs</span>
      <span><strong style="color:#e2e8f0">{len(grouped)}</strong> evals</span>
      <span><strong style="color:#e2e8f0">{", ".join(models_run)}</strong></span>
      <span>total cost <strong style="color:#e2e8f0">${total_cost:.4f}</strong></span>
    </div>
    <div>{mode_tags}</div>
  </div>

  <h2 style="font-size:14px;font-weight:600;color:#64748b;text-transform:uppercase;
             letter-spacing:.08em;margin-bottom:12px">Summary</h2>
  {summary_table}

  <h2 style="font-size:14px;font-weight:600;color:#64748b;text-transform:uppercase;
             letter-spacing:.08em;margin-bottom:16px">Details</h2>
  {detail_sections}

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
