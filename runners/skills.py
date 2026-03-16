"""
Skills runner — LLM with skill file context, no tools.

Each eval declares which skills to load in its PROMPT.md frontmatter. The
runner fetches the corresponding SKILL.md files from the auth0/agent-skills
GitHub repo and injects them into the system prompt.

PROMPT.md frontmatter example:
    ---
    skills: auth0-react
    ---

Multiple skills (comma-separated):
    ---
    skills: auth0-react, auth0-nextjs
    ---
"""

import urllib.request
from .baseline import BaselineResult, run_baseline

AGENT_SKILLS_RAW = (
    "https://raw.githubusercontent.com/auth0/agent-skills/main"
    "/plugins/auth0-sdks/skills/{name}/SKILL.md"
)

# Module-level cache so parallel workers don't re-fetch the same file
_skill_cache: dict[str, str] = {}


def run_skills(
    api_key: str,
    model: str,
    eval_def,           # EvalDefinition from loader.py
) -> BaselineResult:
    """
    Same as baseline but with skill content injected into the system prompt.
    Skills are fetched from GitHub based on the eval's skills declaration.
    """
    skill_context = _fetch_skills(eval_def.skills) if eval_def.skills else ""

    if skill_context:
        parts = ["## SDK Reference Material\n\n" + skill_context]
        if eval_def.system_prompt:
            parts.append(eval_def.system_prompt)
        augmented_system = "\n\n---\n\n".join(parts)
    else:
        augmented_system = eval_def.system_prompt

    class _PatchedEval:
        def __init__(self, base, system):
            self.__dict__.update(base.__dict__)
            self.system_prompt = system

    patched = _PatchedEval(eval_def, augmented_system)
    patched.mode = "skills"

    result = run_baseline(api_key, model, patched)
    result.mode = "skills"
    return result


# ── GitHub fetcher ─────────────────────────────────────────────────────────────

def _fetch_skills(skill_names: list[str]) -> str:
    """Fetch SKILL.md for each named skill from auth0/agent-skills on GitHub."""
    parts: list[str] = []
    for name in skill_names:
        content = _fetch_one(name)
        if content:
            parts.append(f"### {name}\n\n{content}")
        else:
            print(f"  [skills] Warning: could not fetch skill '{name}'")
    return "\n\n---\n\n".join(parts)


def _fetch_one(name: str) -> str:
    if name in _skill_cache:
        return _skill_cache[name]

    url = AGENT_SKILLS_RAW.format(name=name)
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            content = resp.read().decode("utf-8").strip()
            _skill_cache[name] = content
            return content
    except Exception as exc:
        print(f"  [skills] Failed to fetch {url}: {exc}")
        _skill_cache[name] = ""
        return ""

