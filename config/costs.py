# TODO: prices below are approximate and have not been verified.
# Review before using cost figures for any reporting or budgeting.
COST_TABLE = {
    "gpt-5.2":              (10.0, 30.0),
    "claude-4-6-sonnet":    (3.0,  15.0),
    "claude-4-6-opus":      (15.0, 75.0),
    "gemini-3-pro-preview": (2.0,  10.0),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    in_price, out_price = COST_TABLE.get(model, (1.0, 5.0))
    return (input_tokens * in_price + output_tokens * out_price) / 1_000_000
