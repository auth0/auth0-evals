# shellcheck shell=sh
# Auth0 Management API: Guardian (MFA factors + policies).
# Consumed by: mfa_tenant_cli
#
# Sourced by the mocks/auth0 dispatcher. Matches on $ROUTE ("<method> <path>")
# and responds via emit() (from mocks/lib.sh). State is namespaced `mfa_*`.

# Canonical factor list, mirroring fixtures/auth0/guardian_factors.json.
GUARDIAN_FACTORS="sms push-notification otp email duo webauthn-roaming webauthn-platform recovery-code"

case "$ROUTE" in
  # ── Reads: reflect prior writes ─────────────────────────────────────────────
  "get guardian/factors")
    # Emit the factor list, flipping enabled=true for any factor a prior
    # `put/patch guardian/factors/<name>` recorded in this run.
    _out='['
    _first=1
    for _f in $GUARDIAN_FACTORS; do
      if has_state "mfa_factor_$_f"; then _en=true; else _en=false; fi
      [ "$_first" -eq 0 ] && _out="$_out,"
      _first=0
      _out="$_out{\"name\":\"$_f\",\"enabled\":$_en,\"trial_expired\":false}"
    done
    emit "$_out]"
    ;;
  "get guardian/policies")
    if has_state mfa_policy_set; then emit '["all-applications"]'; else emit '[]'; fi
    ;;

  # ── Writes: record state, echo success ──────────────────────────────────────
  "put guardian/factors/"* | "patch guardian/factors/"*)
    _factor="${PATH_##*/}"
    # Record as enabled unless the payload explicitly disables it.
    case "$PAYLOAD" in
      *'"enabled": false'* | *'"enabled":false'*) clear_state "mfa_factor_$_factor" ;;
      *) record_state "mfa_factor_$_factor" ;;
    esac
    emit '{"enabled":true}'
    ;;
  "put guardian/policies" | "patch guardian/policies")
    record_state mfa_policy_set
    emit '["all-applications"]'
    ;;
esac
