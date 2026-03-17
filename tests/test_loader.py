"""Happy path tests for runners/loader.py."""

import pytest

from runners.loader import EvalDefinition, load_eval


# ── Helpers ───────────────────────────────────────────────────────────────────

EVAL_CONFIG = {
    "id": "my_eval",
    "name": "My Eval",
    "category": "quickstarts",
    "path": "my_eval",
}

MINIMAL_PROMPT = "## Task\nDo the task.\n"

DEFAULT_GRADERS = (
    "from agent_eval.graders import contains\n"
    "def define_graders():\n"
    "    return [contains('Auth0Provider')]\n"
)


def make_eval_dir(base, prompt_text=MINIMAL_PROMPT, graders_text=DEFAULT_GRADERS, scaffold_files=None):
    """Create a complete eval directory under *base* and return its path."""
    eval_dir = base / "my_eval"
    eval_dir.mkdir(exist_ok=True)
    (eval_dir / "PROMPT.md").write_text(prompt_text)
    (eval_dir / "graders.py").write_text(graders_text)
    if scaffold_files:
        scaffold = eval_dir / "scaffold"
        scaffold.mkdir(exist_ok=True)
        for rel, content in scaffold_files.items():
            dest = scaffold / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(content)
    return eval_dir


# ── PROMPT.md parsing tests ───────────────────────────────────────────────────


def test_load_eval_parses_frontmatter_and_sections(tmp_path):
    """A PROMPT.md with frontmatter and named sections is parsed so each part
    lands in the right output: system prompt, user prompt, and skills."""
    make_eval_dir(
        tmp_path,
        prompt_text=(
            "---\n"
            "skills: auth0-react\n"
            "name: React Quickstart\n"
            "---\n"
            "\n"
            "## System\n"
            "You are an expert React developer.\n"
            "\n"
            "## Task\n"
            "Add Auth0 authentication to the React app.\n"
        ),
    )

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert "expert React developer" in result.system_prompt
    assert "Add Auth0 authentication" in result.user_prompt
    assert result.skills == ["auth0-react"]


def test_load_eval_parses_sections_without_frontmatter(tmp_path):
    """Named sections are extracted even when no frontmatter block is present
    — frontmatter is optional."""
    make_eval_dir(
        tmp_path,
        prompt_text=(
            "## System\n"
            "You are a developer.\n"
            "\n"
            "## Task\n"
            "Write some code.\n"
        ),
    )

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert "You are a developer" in result.system_prompt
    assert "Write some code" in result.user_prompt
    assert result.skills == []


def test_load_eval_uses_default_system_prompt_without_sections(tmp_path):
    """A plain markdown file without named sections is treated as the task
    prompt, with no system prompt."""
    make_eval_dir(tmp_path, prompt_text="Add Auth0 to the app.")

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert result.system_prompt == ""
    assert "Add Auth0 to the app" in result.user_prompt


def test_load_eval_exposes_frontmatter_in_metadata(tmp_path):
    """All key-value pairs in the frontmatter block are available via metadata
    so consumers can read provider details and other configuration."""
    make_eval_dir(
        tmp_path,
        prompt_text=(
            "---\n"
            "provider_name: MyProvider\n"
            "provider_url: example.com\n"
            "---\n"
            "\n"
            "## Task\n"
            "Do the task.\n"
        ),
    )

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert result.metadata["provider_name"] == "MyProvider"
    assert result.metadata["provider_url"] == "example.com"


def test_load_eval_missing_prompt_raises(tmp_path):
    """A missing PROMPT.md raises an error rather than silently producing
    empty prompts that would cause a confusing eval run."""
    eval_dir = tmp_path / "my_eval"
    eval_dir.mkdir()
    (eval_dir / "graders.py").write_text(DEFAULT_GRADERS)

    with pytest.raises(FileNotFoundError):
        load_eval(EVAL_CONFIG, tmp_path)


# ── Scaffold loading tests ────────────────────────────────────────────────────


def test_load_eval_loads_scaffold_files(tmp_path):
    """All files in the scaffold directory are loaded with their content so
    the agent workspace starts with the correct starter files."""
    make_eval_dir(
        tmp_path,
        scaffold_files={
            "App.js": "const App = () => <div/>;",
            "index.js": "ReactDOM.render(<App/>, root);",
        },
    )

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert len(result.scaffold) == 2
    assert any("App.js" in k for k in result.scaffold)
    assert any("const App" in v for v in result.scaffold.values())


def test_load_eval_empty_scaffold_when_no_scaffold_dir(tmp_path):
    """When no scaffold directory exists the agent workspace starts empty —
    some evals intentionally provide no starter files."""
    make_eval_dir(tmp_path)

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert result.scaffold == {}


def test_load_eval_scaffold_preserves_subdirectory_paths(tmp_path):
    """Files in subdirectories retain their relative paths so the workspace
    directory structure is reproduced exactly as the scaffold defined it."""
    make_eval_dir(tmp_path, scaffold_files={"src/App.js": "app code"})

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert any("src" in k for k in result.scaffold)


def test_load_eval_scaffold_single_file(tmp_path):
    """A scaffold with a single file returns exactly that file and its full
    content — no truncation or transformation."""
    make_eval_dir(tmp_path, scaffold_files={"main.swift": "import Auth0"})

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert result.scaffold.get("main.swift") == "import Auth0"


# ── Graders loading tests ─────────────────────────────────────────────────────


def test_load_eval_loads_graders(tmp_path):
    """Loading the eval makes define_graders() results available as the
    graders list, ready for run_graders to consume."""
    make_eval_dir(tmp_path)

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert len(result.graders) == 1
    assert result.graders[0]["kind"] == "contains"
    assert result.graders[0]["needle"] == "Auth0Provider"


def test_load_eval_loads_multiple_graders(tmp_path):
    """define_graders() can return multiple graders of different kinds so a
    single eval can check for a variety of requirements."""
    make_eval_dir(
        tmp_path,
        graders_text=(
            "from agent_eval.graders import contains, matches\n"
            "def define_graders():\n"
            "    return [\n"
            "        contains('Auth0Provider'),\n"
            "        matches(r'useAuth0'),\n"
            "    ]\n"
        ),
    )

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert len(result.graders) == 2
    assert {g["kind"] for g in result.graders} == {"contains", "matches"}


def test_load_eval_missing_graders_raises(tmp_path):
    """A missing graders.py raises an error rather than producing an eval
    with no acceptance criteria."""
    eval_dir = tmp_path / "my_eval"
    eval_dir.mkdir()
    (eval_dir / "PROMPT.md").write_text(MINIMAL_PROMPT)

    with pytest.raises(FileNotFoundError):
        load_eval(EVAL_CONFIG, tmp_path)


def test_load_eval_missing_define_graders_raises(tmp_path):
    """A graders.py that omits define_graders() raises an error rather than
    silently yielding an eval with no graders."""
    make_eval_dir(tmp_path, graders_text="# no define_graders function here\n")

    with pytest.raises(AttributeError):
        load_eval(EVAL_CONFIG, tmp_path)


# ── load_eval integration tests ───────────────────────────────────────────────


def test_load_eval_returns_eval_definition(tmp_path):
    """Loading a complete eval directory produces a fully-populated
    EvalDefinition with prompts, graders, scaffold, and skills ready for use."""
    eval_dir = tmp_path / "my_eval"
    eval_dir.mkdir()

    (eval_dir / "PROMPT.md").write_text(
        "---\n"
        "skills: auth0-react\n"
        "name: My Eval\n"
        "provider_name: Auth0\n"
        "---\n"
        "\n"
        "## System\n"
        "You are an expert.\n"
        "\n"
        "## Task\n"
        "Add authentication.\n"
    )
    (eval_dir / "graders.py").write_text(DEFAULT_GRADERS)
    scaffold_dir = eval_dir / "scaffold"
    scaffold_dir.mkdir()
    (scaffold_dir / "App.js").write_text("// starter")

    result = load_eval(EVAL_CONFIG, tmp_path)

    assert isinstance(result, EvalDefinition)
    assert result.id == "my_eval"
    assert result.name == "My Eval"
    assert len(result.graders) == 1
    assert result.graders[0]["kind"] == "contains"
    assert "App.js" in result.scaffold
    assert result.skills == ["auth0-react"]


def test_load_eval_missing_directory_raises(tmp_path):
    """A missing eval directory raises an error rather than loading a partial
    or empty eval that would produce meaningless results."""
    eval_config = {
        "id": "nonexistent",
        "path": "nonexistent",
    }
    with pytest.raises(FileNotFoundError):
        load_eval(eval_config, tmp_path)
