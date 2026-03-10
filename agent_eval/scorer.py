"""
5-dimension scorer.

Implements the quantitative formula from the 2027.dev Agent Arena scorecard:
  score = friction×0.25 + speed×0.20 + efficiency×0.20 + errors×0.15 + docs×0.20

Each dimension is scored 0–100 and maps to a letter grade.
"""

from dataclasses import dataclass, field
from typing import Optional

from .agent import RunRecord
from .graders import GraderResult, pass_rate as grader_pass_rate_fn


# ── Grade thresholds ──────────────────────────────────────────────────────────

def score_to_grade(score: float) -> str:
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 60:
        return "C"
    if score >= 40:
        return "D"
    return "F"


# ── Dimension result ──────────────────────────────────────────────────────────

@dataclass
class DimensionScore:
    name: str
    weight: float          # 0.0–1.0
    raw_score: float       # 0–100
    grade: str
    notes: str
    weighted: float = 0.0

    def __post_init__(self):
        self.weighted = self.raw_score * self.weight


@dataclass
class ScoredResult:
    run_record: RunRecord
    dimensions: list[DimensionScore]
    overall_score: float
    overall_grade: str
    doc_features: dict[str, bool]           # AI discoverability feature flags
    grader_results: list[GraderResult] = field(default_factory=list)

    @property
    def grader_pass_rate(self) -> float:
        return grader_pass_rate_fn(self.grader_results)


# ── Scoring formulas (calibrated to the 2027.dev reference run) ───────────────

def _score_friction(record: RunRecord) -> tuple[float, str]:
    """
    Penalise hard interruptions (agent asked user a question) and provider errors.
    Reference: 2 interruptions → 72.0
    """
    score = 100.0
    # Hard interrupt penalty (agent couldn't proceed without user input)
    score -= record.interruption_count * 14.0
    # Provider-caused error penalty
    score -= len(record.provider_errors) * 10.0
    score = max(0.0, score)

    interrupt_str = (
        f"{record.interruption_count} interruption(s)"
        if record.interruption_count
        else "zero interruptions"
    )
    error_str = (
        f"{len(record.provider_errors)} provider error(s)"
        if record.provider_errors
        else "zero provider errors"
    )
    notes = f"{interrupt_str}; {error_str}"
    return round(score, 1), notes


def _score_speed(record: RunRecord, reference_active_s: float = 60.0) -> tuple[float, str]:
    """
    Score active agent time. Ideal ≤ 60 s = 100; degrades by 0.4 pts/sec beyond that.
    Reference: 80 s active → ~92 (close to 91.1 in report).
    """
    excess = max(0.0, record.active_time - reference_active_s)
    score = max(0.0, 100.0 - excess * 0.4)
    notes = (
        f"{record.active_time:.0f}s active / {record.wall_time:.0f}s wall; "
        f"{'no' if record.doc_lookup_count == 0 else str(record.doc_lookup_count)} doc lookups"
    )
    return round(score, 1), notes


def _score_efficiency(record: RunRecord, ideal_calls: int = 10) -> tuple[float, str]:
    """
    Score tool-call count. Ideal = ideal_calls; degrades proportionally above that.
    Reference: 18 calls → 100×(10/18) ≈ 55.6 ≈ 56.4 in report.
    """
    total = len(record.tool_calls)
    if total == 0:
        return 0.0, "No tool calls recorded"
    score = min(100.0, 100.0 * ideal_calls / max(ideal_calls, total))
    summary = record.tool_call_summary()
    notes = f"{total} tool calls — {summary}"
    return round(score, 1), notes


def _score_errors(record: RunRecord) -> tuple[float, str]:
    """
    Score provider-caused errors. Zero errors = 100.
    Critical errors (SDK crash, auth failure) = -30 each; minor = -10 each.
    """
    score = 100.0 - len(record.provider_errors) * 20.0
    score = max(0.0, score)
    if not record.provider_errors:
        notes = "Zero provider errors. SDK behaved correctly on first use."
    else:
        notes = "; ".join(record.provider_errors[:3])
    return round(score, 1), notes


def _score_docs(doc_features: dict[str, bool]) -> tuple[float, str]:
    """
    Pre-scored AI discoverability. Each of 5 features worth 20 points.
    Features: llms_txt, context7, mcp_server, typed_sdk, openapi_spec.
    """
    score = sum(20.0 for v in doc_features.values() if v)
    present = [k for k, v in doc_features.items() if v]
    missing = [k for k, v in doc_features.items() if not v]
    present_str = ", ".join(present) if present else "none"
    missing_str = ", ".join(missing) if missing else "none"
    notes = (
        f"{len(present)}/5 AI discoverability: {present_str}. "
        f"Missing: {missing_str}."
    )
    return round(score, 1), notes


# ── Public API ────────────────────────────────────────────────────────────────

# Default Auth0 Swift SDK doc features (pre-scored)
AUTH0_SWIFT_DOC_FEATURES = {
    "llms_txt": True,
    "context7": True,
    "mcp_server": True,
    "typed_sdk": True,
    "openapi_spec": False,
}


def score(
    record: RunRecord,
    doc_features: Optional[dict[str, bool]] = None,
) -> ScoredResult:
    """
    Score a RunRecord and return a ScoredResult with all dimension breakdowns.
    """
    if doc_features is None:
        doc_features = AUTH0_SWIFT_DOC_FEATURES

    friction_score, friction_notes = _score_friction(record)
    speed_score, speed_notes       = _score_speed(record)
    eff_score, eff_notes           = _score_efficiency(record)
    err_score, err_notes           = _score_errors(record)
    doc_score, doc_notes           = _score_docs(doc_features)

    dimensions = [
        DimensionScore("Setup Friction",  0.25, friction_score, score_to_grade(friction_score), friction_notes),
        DimensionScore("Setup Speed",     0.20, speed_score,    score_to_grade(speed_score),    speed_notes),
        DimensionScore("Efficiency",      0.20, eff_score,      score_to_grade(eff_score),      eff_notes),
        DimensionScore("Error Recovery",  0.15, err_score,      score_to_grade(err_score),      err_notes),
        DimensionScore("Doc Quality",     0.20, doc_score,      score_to_grade(doc_score),      doc_notes),
    ]

    overall = sum(d.weighted for d in dimensions)
    overall = round(overall, 1)

    return ScoredResult(
        run_record=record,
        dimensions=dimensions,
        overall_score=overall,
        overall_grade=score_to_grade(overall),
        doc_features=doc_features,
    )
