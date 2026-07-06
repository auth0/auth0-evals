# shellcheck shell=sh
# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers for mock CLI route files (sourced by the dispatcher).
#
# Route files under mocks/routes/*.sh use these to record/read per-run state and
# emit responses, so each route file stays small and self-contained. State lives
# under $STATE (EVAL_MOCK_STATE_DIR) — a per-run temp dir OUTSIDE the workspace,
# so graders never see it. Namespace your markers to avoid collisions across
# features, e.g. `mfa_factor_otp`, `cte_action_created`.
# ─────────────────────────────────────────────────────────────────────────────

# record_state <key>       — mark a key as set for this run.
record_state() { touch "$STATE/$1" 2>/dev/null || true; }

# clear_state <key>        — unset a key.
clear_state() { rm -f "$STATE/$1" 2>/dev/null || true; }

# has_state <key>          — succeed (exit 0) if the key was recorded.
has_state() { [ -f "$STATE/$1" ]; }

# emit <body>              — print a response body and mark the request handled.
# Sets HANDLED=1 so the dispatcher stops trying further route files and skips the
# fallthrough. Route files call this instead of a bare echo.
emit() {
  printf '%s\n' "$1"
  HANDLED=1
}
