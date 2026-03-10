"""
Skills runner — LLM with skill file context, no tools.

Loads all *.md files from eval_framework/skills/ and prepends their content
to the system prompt before the single LLM call. This gives the model
pre-loaded SDK reference material without any tool calls.

Equivalent to exec.ts "Skills" mode in the reference architecture.
"""

from pathlib import Path
from .baseline import BaselineResult, run_baseline


def run_skills(
    api_key: str,
    model: str,
    eval_def,           # EvalDefinition from loader.py
    skills_dir: Path,
) -> BaselineResult:
    """
    Same as baseline but with skill files injected into the system prompt.
    """
    skill_context = _load_skills(skills_dir)

    if skill_context:
        augmented_system = (
            "## SDK Reference Material\n\n"
            + skill_context
            + "\n\n---\n\n"
            + eval_def.system_prompt
        )
    else:
        augmented_system = eval_def.system_prompt

    # Temporarily patch the system prompt for this run
    class _PatchedEval:
        def __init__(self, base, system):
            self.__dict__.update(base.__dict__)
            self.system_prompt = system

    patched = _PatchedEval(eval_def, augmented_system)
    patched.mode = "skills"

    result = run_baseline(api_key, model, patched)
    result.mode = "skills"
    return result


# ── Skill loader ──────────────────────────────────────────────────────────────

def _load_skills(skills_dir: Path) -> str:
    """
    Read all *.md files from skills_dir and concatenate them.
    Returns empty string if directory does not exist or is empty.
    """
    if not skills_dir.is_dir():
        return ""

    parts: list[str] = []
    for skill_file in sorted(skills_dir.glob("*.md")):
        content = skill_file.read_text().strip()
        if content:
            parts.append(f"### {skill_file.stem}\n\n{content}")

    return "\n\n---\n\n".join(parts)
