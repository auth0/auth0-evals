"""
8-dimension scorer.

Process dimensions (50%): Setup Friction (15%), Setup Speed (10%), Efficiency (10%), 
Error Recovery (5%), Docs Quality (10%)

Output dimensions (50%): Correctness (25%), Hallucination (15%), Security (10%)

Each dimension is scored 0–100 and maps to a letter grade.
Overall score = weighted sum across all 8 dimensions.
"""

from dataclasses import dataclass, field
from typing import Optional

from .agent import RunRecord
from .graders import GraderResult, pass_rate as grader_pass_rate_fn


# ── Scoring constants ─────────────────────────────────────────────────────────

# Grade thresholds
GRADE_A_MIN: float = 90
GRADE_B_MIN: float = 75
GRADE_C_MIN: float = 60
GRADE_D_MIN: float = 40

# Setup Friction
FRICTION_INTERRUPTION_PENALTY: float = 14.0   # pts per hard interruption
FRICTION_PROVIDER_ERROR_PENALTY: float = 10.0  # pts per provider-caused error

# Setup Speed
SPEED_IDEAL_ACTIVE_S: float = 60.0  # seconds; at or below this = 100 pts
SPEED_DEGRADATION_RATE: float = 0.4  # pts lost per second over ideal

# Efficiency
EFFICIENCY_IDEAL_CALLS: int = 10  # tool calls at or below this = 100 pts

# Error Recovery
ERROR_RECOVERY_PENALTY: float = 20.0  # pts per provider error

# Docs Quality
DOCS_FEATURE_POINTS: float = 20.0  # pts per AI-discoverability feature (5 features × 20 = 100)

# Hallucination
HALLUCINATION_PENALTY: float = 20.0  # pts per hallucination detected

# Security
SECURITY_PENALTY_HARDCODED_SECRET: float = 30.0  # hardcoded client_secret / api_key / password
SECURITY_PENALTY_INSECURE_STORAGE: float = 20.0  # token stored in localStorage
SECURITY_PENALTY_EXPOSED_SECRET: float = 25.0    # secret leaked to frontend via env var


# ── Grade thresholds ──────────────────────────────────────────────────────────

def score_to_grade(score: float) -> str:
    if score >= GRADE_A_MIN:
        return "A"
    if score >= GRADE_B_MIN:
        return "B"
    if score >= GRADE_C_MIN:
        return "C"
    if score >= GRADE_D_MIN:
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
    Setup Friction: Did the agent get stuck and need human help? 
    Did it hit errors during setup?
    Penalise hard interruptions and provider errors.
    """
    score = 100.0
    # Hard interrupt penalty (agent couldn't proceed without user input)
    score -= record.interruption_count * FRICTION_INTERRUPTION_PENALTY
    # Provider-caused error penalty
    score -= len(record.provider_errors) * FRICTION_PROVIDER_ERROR_PENALTY
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


def _score_speed(record: RunRecord, reference_active_s: float = SPEED_IDEAL_ACTIVE_S) -> tuple[float, str]:
    """
    Setup Speed: How long did the agent actively spend on the task?
    Ideal ≤ 60 s = 100; degrades by 0.4 pts/sec beyond that.
    """
    excess = max(0.0, record.active_time - reference_active_s)
    score = max(0.0, 100.0 - excess * SPEED_DEGRADATION_RATE)
    notes = (
        f"{record.active_time:.0f}s active / {record.wall_time:.0f}s wall; "
        f"{'no' if record.doc_lookup_count == 0 else str(record.doc_lookup_count)} doc lookups"
    )
    return round(score, 1), notes


def _score_efficiency(record: RunRecord, ideal_calls: int = EFFICIENCY_IDEAL_CALLS) -> tuple[float, str]:
    """
    Efficiency: How many actions did it take to complete the task? 
    Did the agent thrash or take a direct path? How many tokens did the agent spend?
    Scores tool-call count. Ideal = ideal_calls; degrades proportionally above that.
    For non-agent modes (baseline/skills), returns 100 (N/A - no tools used).
    """
    total = len(record.tool_calls)
    if total == 0:
        # Baseline/skills modes don't use tools - this dimension doesn't apply
        return 100.0, "N/A (no tools in baseline/skills mode)"
    score = min(100.0, 100.0 * ideal_calls / max(ideal_calls, total))
    summary = record.tool_call_summary()
    notes = f"{total} tool calls — {summary}"
    return round(score, 1), notes


def _score_errors(record: RunRecord) -> tuple[float, str]:
    """
    Error Recovery: When the agent hit errors, did it recover or spiral?
    Score provider-caused errors. Zero errors = 100.
    Each provider error = -20 pts (ERROR_RECOVERY_PENALTY).
    """
    score = 100.0 - len(record.provider_errors) * ERROR_RECOVERY_PENALTY
    score = max(0.0, score)
    if not record.provider_errors:
        notes = "Zero provider errors. SDK behaved correctly on first use."
    else:
        notes = "; ".join(record.provider_errors[:3])
    return round(score, 1), notes


def _score_docs(doc_features: dict[str, bool]) -> tuple[float, str]:
    """
    Docs Quality: Can agents discover SDKs, CLI, llms.txt, MCP server, 
    agent0skills, OpenAPI spec?
    Pre-scored AI discoverability. Each of 5 features worth 20 points.
    Features: llms_txt, context7, mcp_server, typed_sdk, openapi_spec.
    """
    score = min(100.0, sum(DOCS_FEATURE_POINTS for v in doc_features.values() if v))
    present = [k for k, v in doc_features.items() if v]
    missing = [k for k, v in doc_features.items() if not v]
    present_str = ", ".join(present) if present else "none"
    missing_str = ", ".join(missing) if missing else "none"
    notes = (
        f"{len(present)}/{len(doc_features)} AI discoverability: {present_str}. "
        f"Missing: {missing_str}."
    )
    return round(score, 1), notes


def _score_correctness(grader_results: list[GraderResult]) -> tuple[float, str]:
    """
    Correctness: Did the agent produce code that passes the eval's graders?
    What fraction of checks pass?
    Score = 100 * (passed / total)
    """
    if not grader_results:
        return 0.0, "No graders run"
    
    passed = sum(1 for g in grader_results if g.passed)
    total = len(grader_results)
    score = 100.0 * passed / total
    notes = f"{passed}/{total} graders passed ({score:.0f}%)"
    return round(score, 1), notes


def _score_hallucination(workspace: str) -> tuple[float, str]:
    """
    Hallucination: Did the agent invent things that don't exist—
    fake imports, non-existent methods, made-up packages?
    
    Checks for common hallucination patterns in code.
    """
    import re
    from pathlib import Path
    
    score = 100.0
    issues = []
    
    # Common fake packages/imports in Auth0 context
    fake_patterns = [
        (r"from\s+auth0\s+import\s+Auth0Client", "Auth0Client doesn't exist in auth0 package"),
        (r"import\s+@auth0/auth0-sdk", "@auth0/auth0-sdk doesn't exist"),
        (r"Auth0\.configure\(", "Auth0.configure() not a real method"),
        (r"auth0\.loginWithRedirect\(", "Incorrect method name (should be loginWithPopup)"),
    ]
    
    # Scan all files
    for path in Path(workspace).rglob("*"):
        if path.is_file() and path.suffix in ['.js', '.jsx', '.ts', '.tsx', '.swift', '.py']:
            try:
                content = path.read_text(errors='replace')
                for pattern, description in fake_patterns:
                    if re.search(pattern, content, re.IGNORECASE):
                        issues.append(f"{path.name}: {description}")
                        score -= HALLUCINATION_PENALTY
            except Exception:
                pass
    
    score = max(0.0, score)
    
    if not issues:
        notes = "No hallucinations detected"
    else:
        notes = "; ".join(issues[:3])  # Limit to first 3
        if len(issues) > 3:
            notes += f" (+{len(issues)-3} more)"
    
    return round(score, 1), notes


def _score_security(workspace: str) -> tuple[float, str]:
    """
    Security: Did the agent introduce auth-specific vulnerabilities—
    hardcoded secrets, tokens in localStorage, missing CSRF, 
    exposed client_secret in SPA code?
    """
    import re
    from pathlib import Path
    
    score = 100.0
    issues = []
    
    # Security vulnerability patterns
    vuln_patterns = [
        (r"client_secret\s*[=:]\s*['\"][^'\"]+['\"]", "Hardcoded client_secret", SECURITY_PENALTY_HARDCODED_SECRET),
        (r"localStorage\.setItem\(['\"].*token", "Token in localStorage (use secure cookie)", SECURITY_PENALTY_INSECURE_STORAGE),
        (r"api_key\s*[=:]\s*['\"][^'\"]+['\"]", "Hardcoded API key", SECURITY_PENALTY_HARDCODED_SECRET),
        (r"password\s*[=:]\s*['\"][^'\"]+['\"]", "Hardcoded password", SECURITY_PENALTY_HARDCODED_SECRET),
        (r"client_secret.*process\.env", "client_secret exposed in frontend", SECURITY_PENALTY_EXPOSED_SECRET),
    ]
    
    # Scan all files
    for path in Path(workspace).rglob("*"):
        if path.is_file() and path.suffix in ['.js', '.jsx', '.ts', '.tsx', '.swift', '.py']:
            try:
                content = path.read_text(errors='replace')
                for pattern, description, penalty in vuln_patterns:
                    if re.search(pattern, content, re.IGNORECASE):
                        issues.append(f"{path.name}: {description}")
                        score -= penalty
            except Exception:
                pass
    
    score = max(0.0, score)
    
    if not issues:
        notes = "No security vulnerabilities detected"
    else:
        notes = "; ".join(issues[:3])  # Limit to first 3
        if len(issues) > 3:
            notes += f" (+{len(issues)-3} more)"
    
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
    grader_results: Optional[list[GraderResult]] = None,
) -> ScoredResult:
    """
    Score a RunRecord and return a ScoredResult with all dimension breakdowns.
    8 dimensions: 5 process + 3 output.
    """
    if doc_features is None:
        doc_features = AUTH0_SWIFT_DOC_FEATURES
    if grader_results is None:
        grader_results = []

    # Process dimensions (50% total)
    friction_score, friction_notes = _score_friction(record)
    speed_score, speed_notes       = _score_speed(record)
    eff_score, eff_notes           = _score_efficiency(record)
    err_score, err_notes           = _score_errors(record)
    doc_score, doc_notes           = _score_docs(doc_features)
    
    # Output dimensions (50% total)
    correctness_score, correctness_notes = _score_correctness(grader_results)
    hallucination_score, hallucination_notes = _score_hallucination(record.workspace)
    security_score, security_notes = _score_security(record.workspace)

    dimensions = [
        # Process dimensions (50%)
        DimensionScore("Setup Friction",  0.15, friction_score, score_to_grade(friction_score), friction_notes),
        DimensionScore("Setup Speed",     0.10, speed_score,    score_to_grade(speed_score),    speed_notes),
        DimensionScore("Efficiency",      0.10, eff_score,      score_to_grade(eff_score),      eff_notes),
        DimensionScore("Error Recovery",  0.05, err_score,      score_to_grade(err_score),      err_notes),
        DimensionScore("Docs Quality",    0.10, doc_score,      score_to_grade(doc_score),      doc_notes),
        # Output dimensions (50%)
        DimensionScore("Correctness",     0.25, correctness_score, score_to_grade(correctness_score), correctness_notes),
        DimensionScore("Hallucination",   0.15, hallucination_score, score_to_grade(hallucination_score), hallucination_notes),
        DimensionScore("Security",        0.10, security_score, score_to_grade(security_score), security_notes),
    ]

    overall = sum(d.weighted for d in dimensions)
    overall = round(overall, 1)

    result = ScoredResult(
        run_record=record,
        dimensions=dimensions,
        overall_score=overall,
        overall_grade=score_to_grade(overall),
        doc_features=doc_features,
        grader_results=grader_results,
    )
    
    return result
