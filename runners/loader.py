"""
Eval loader — reads a self-contained eval directory.

Each eval directory contains:
  PROMPT.md   — frontmatter metadata + ## System and ## Task sections
  graders.py  — define_graders() returning a list of grader dicts
  scaffold/   — (optional) starter files written to the agent workspace
"""

import importlib.util
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class EvalDefinition:
    id: str
    name: str
    category: str
    path: Path
    system_prompt: str
    user_prompt: str
    graders: list[dict]
    scaffold: dict[str, str]               # relative_path -> content
    skills: list[str] = field(default_factory=list)   # skill names to fetch
    metadata: dict = field(default_factory=dict)


def load_eval(eval_config: dict, framework_root: Path) -> EvalDefinition:
    """
    Load an eval from its directory given a registry entry dict.

    eval_config: entry from config/evaluations.py::EVALUATIONS
    framework_root: absolute path to eval_framework/
    """
    eval_path = framework_root / eval_config["path"]
    if not eval_path.is_dir():
        raise FileNotFoundError(f"Eval directory not found: {eval_path}")

    system_prompt, user_prompt, meta = _parse_prompt_md(eval_path / "PROMPT.md")
    graders_module = _load_graders_module(eval_path / "graders.py")
    scaffold = _load_scaffold(eval_path / "scaffold")

    skills = [s.strip() for s in meta.get("skills", "").split(",") if s.strip()]

    return EvalDefinition(
        id=eval_config["id"],
        name=eval_config.get("name", meta.get("name", eval_config["id"])),
        category=eval_config.get("category", meta.get("category", "")),
        path=eval_path,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        graders=graders_module.define_graders(),
        scaffold=scaffold,
        skills=skills,
        metadata={
            "provider_name": meta.get("provider_name", "Auth0"),
            "provider_url":  meta.get("provider_url", "auth0.com"),
            "category":      eval_config.get("category", ""),
            "task_description": meta.get("task_description", eval_config.get("name", "")),
        },
    )


# ── PROMPT.md parser ──────────────────────────────────────────────────────────

def _parse_prompt_md(prompt_path: Path) -> tuple[str, str, dict]:
    """
    Parse PROMPT.md into (system_prompt, user_prompt, metadata_dict).

    Expected format:
      ---
      key: value
      ---

      ## System
      <system prompt text>

      ## Task
      <user/task prompt text>
    """
    if not prompt_path.exists():
        raise FileNotFoundError(f"PROMPT.md not found: {prompt_path}")

    text = prompt_path.read_text()

    # Extract YAML-ish frontmatter between --- delimiters
    meta: dict = {}
    front_match = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if front_match:
        for line in front_match.group(1).splitlines():
            if ":" in line:
                k, _, v = line.partition(":")
                meta[k.strip()] = v.strip()
        text = text[front_match.end():]

    # If ## System / ## Task sections exist, use them; otherwise treat the
    # whole body as the user prompt and use a minimal system prompt.
    system_match = re.search(r"^## System\s*\n(.*?)(?=^## |\Z)", text, re.DOTALL | re.MULTILINE)
    task_match   = re.search(r"^## Task\s*\n(.*?)(?=^## |\Z)",   text, re.DOTALL | re.MULTILINE)

    if system_match or task_match:
        system_prompt = system_match.group(1).strip() if system_match else ""
        user_prompt   = task_match.group(1).strip()   if task_match   else text.strip()
    else:
        system_prompt = "You are an expert iOS/Swift developer."
        user_prompt   = text.strip()

    return system_prompt, user_prompt, meta


# ── graders.py dynamic import ─────────────────────────────────────────────────

def _load_graders_module(graders_path: Path):
    """Dynamically import graders.py from an eval directory."""
    if not graders_path.exists():
        raise FileNotFoundError(f"graders.py not found: {graders_path}")

    spec = importlib.util.spec_from_file_location("_eval_graders", graders_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if not hasattr(module, "define_graders"):
        raise AttributeError(f"graders.py missing define_graders(): {graders_path}")

    return module


# ── scaffold loader ───────────────────────────────────────────────────────────

def _load_scaffold(scaffold_dir: Path) -> dict[str, str]:
    """
    Walk scaffold/ and return {relative_path: content} for every text file.
    Returns empty dict if scaffold/ does not exist.
    """
    if not scaffold_dir.is_dir():
        return {}

    files: dict[str, str] = {}
    for path in scaffold_dir.rglob("*"):
        if path.is_file():
            rel = str(path.relative_to(scaffold_dir))
            try:
                files[rel] = path.read_text()
            except Exception:
                pass
    return files
