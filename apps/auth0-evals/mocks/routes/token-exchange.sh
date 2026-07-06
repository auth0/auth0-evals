# shellcheck shell=sh
# Auth0 Management API: Custom Token Exchange (Actions + token-exchange-profiles).
# Consumed by: cte_tenant_cli
#
# Sourced by the mocks/auth0 dispatcher. Matches on $ROUTE ("<method> <path>")
# and responds via emit() (from mocks/lib.sh). State is namespaced `cte_*`.

case "$ROUTE" in
  # Create an Action. Record it and return a fixed id the agent can reuse for
  # the deploy + profile steps (the real API returns a generated id).
  "post actions")
    record_state cte_action_created
    emit '{"id":"act_cte_validator","name":"cte-validator","supported_triggers":[{"id":"custom-token-exchange","version":"v1"}]}'
    ;;
  # Deploy an Action (path is actions/<id>/deploy after normalization).
  "post actions/"*"/deploy")
    record_state cte_action_deployed
    emit '{"id":"act_cte_validator","deployed":true}'
    ;;
  "get actions" | "get actions/"*)
    # Reflect whether an action was created/deployed in this run.
    if has_state cte_action_deployed; then _dep=true; else _dep=false; fi
    if has_state cte_action_created; then
      emit '{"actions":[{"id":"act_cte_validator","name":"cte-validator","deployed":'"$_dep"',"supported_triggers":[{"id":"custom-token-exchange","version":"v1"}]}]}'
    else
      emit '{"actions":[]}'
    fi
    ;;
  # Create a token exchange profile. Record it and echo it back.
  "post token-exchange-profiles")
    record_state cte_tep_created
    emit '{"id":"tep_legacy","name":"legacy-migration","type":"custom_authentication","action_id":"act_cte_validator"}'
    ;;
  "get token-exchange-profiles" | "get token-exchange-profiles/"*)
    if has_state cte_tep_created; then
      emit '{"token_exchange_profiles":[{"id":"tep_legacy","name":"legacy-migration","type":"custom_authentication","action_id":"act_cte_validator"}]}'
    else
      emit '{"token_exchange_profiles":[]}'
    fi
    ;;
esac
