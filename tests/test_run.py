"""Tests for run.py.

run_job() is the main public function but is difficult to unit test because
FRAMEWORK_ROOT is a module-level constant (not injectable) and every execution
path calls out to real LLM APIs. The components it orchestrates are covered by
their own test modules: test_loader, test_baseline, test_graders, test_scorer.
"""

import run


def test_default_model():
    assert run.DEFAULT_MODEL == "gpt-5.2"


def test_extract_single_block():
    text = "Some prose.\n```js\nconst x = 1;\n```\nMore prose."
    assert run._extract_code_blocks(text) == "const x = 1;\n"


def test_extract_multiple_blocks():
    text = "Intro.\n```js\nconst a = 1;\n```\nMiddle.\n```jsx\nconst b = 2;\n```\nEnd."
    result = run._extract_code_blocks(text)
    assert "const a = 1;" in result
    assert "const b = 2;" in result


def test_extract_strips_surrounding_prose():
    text = "You should use Auth0Provider here.\n```jsx\nconst x = 1;\n```\nHope that helps!"
    result = run._extract_code_blocks(text)
    assert "Auth0Provider" not in result
    assert "Hope that helps" not in result


def test_extract_no_blocks_falls_back_to_full_text():
    text = "Just plain text with no fences."
    assert run._extract_code_blocks(text) == text


def test_extract_keyword_in_prose_only_not_found():
    text = "Make sure to call loginWithRedirect when the user clicks login.\n```jsx\nfunction App() { return <div />; }\n```"
    result = run._extract_code_blocks(text)
    assert "loginWithRedirect" not in result


def test_extract_keyword_in_code_block_found():
    text = "Here is how:\n```jsx\nloginWithRedirect();\n```"
    result = run._extract_code_blocks(text)
    assert "loginWithRedirect" in result


def test_extract_block_without_language_tag():
    text = "```\nplain code\n```"
    assert run._extract_code_blocks(text) == "plain code\n"


def test_extract_block_with_complex_language_tag():
    for tag in ("objective-c", "c++", "text.html", "c#", "bash linenos"):
        text = f"```{tag}\nsome code\n```"
        assert run._extract_code_blocks(text) == "some code\n", f"failed for tag: {tag}"


def test_extract_windows_line_endings():
    text = "```js\r\nconst x = 1;\r\n```"
    assert "const x = 1;" in run._extract_code_blocks(text)


def test_extract_empty_block_returns_empty_string():
    text = "```\n```"
    result = run._extract_code_blocks(text)
    assert result == ""


def test_extract_prose_only_response_unchanged():
    text = "import Auth0\nAuth0.webAuth(clientId: x, domain: y)"
    assert run._extract_code_blocks(text) == text


def test_extract_unterminated_fence_does_not_scan_prose():
    text = "Make sure to call loginWithRedirect when the user clicks login.\n```jsx\nfunction App() { return <div />; }"
    result = run._extract_code_blocks(text)
    assert "loginWithRedirect" not in result
