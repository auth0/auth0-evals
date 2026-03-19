"""
Skills loader — fetches and injects SKILL.md context into eval prompts.

Each eval declares which skills to load in its PROMPT.md frontmatter. This
module resolves SKILL.md files from the auth0/agent-skills GitHub repo and
augments the eval's system prompt with the skill content.

In agent+skills mode, the augmented eval is then run through the full
agentic loop — the agent gets both tool access and skill context.

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

AGENT_SKILLS_RAW = (
    "https://raw.githubusercontent.com/auth0/agent-skills/main"
    "/plugins/auth0-sdks/skills/{name}/SKILL.md"
)

# Module-level cache so parallel workers don't re-fetch the same file
_skill_cache: dict[str, str] = {}


def augment_with_skills(eval_def):
    """
    Return a copy of eval_def with skill content injected into the system prompt.
    If the eval has no skills declared, returns the original eval_def unchanged.
    """
    if not eval_def.skills:
        return eval_def

    skill_context = _fetch_skills(eval_def.skills)
    if not skill_context:
        return eval_def

    parts = ["## SDK Reference Material\n\n" + skill_context]
    if eval_def.system_prompt:
        parts.append(eval_def.system_prompt)
    augmented_system = "\n\n---\n\n".join(parts)

    class _AugmentedEval:
        def __init__(self, base, system):
            self.__dict__.update(base.__dict__)
            self.system_prompt = system

    return _AugmentedEval(eval_def, augmented_system)


# ── GitHub fetcher ────────────────────────────────────────────────────────────

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
