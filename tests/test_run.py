import run


def test_default_model():
    assert run.DEFAULT_MODEL == "gpt-5.2"
