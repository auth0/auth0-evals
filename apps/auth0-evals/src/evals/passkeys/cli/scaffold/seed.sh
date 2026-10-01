#!/usr/bin/env bash
# Seeds the throwaway tenant with the prerequisites this task assumes already
# exist: a database connection for the agent to enable passkeys on.
#
# Runs before the agent, in the same container the `auth0` CLI is authenticated
# into. Must be idempotent — hence `set -uo pipefail` (not `-e`).
set -uo pipefail

log() { echo "[seed] $*" >&2; }

log "start: seeding tenant prerequisites"

# Default database connection (normally auto-created with a tenant, but seed
# defensively — some provisioned tenants come up bare).
LOOKUP=$(auth0 api get "connections?name=Username-Password-Authentication" 2>/dev/null)
LOOKUP_STATUS=$?
if [ $LOOKUP_STATUS -ne 0 ]; then
  log "error: failed to look up connections — aborting to avoid a spurious duplicate create"
  exit 1
fi
if echo "$LOOKUP" | jq -e '.[0]' >/dev/null 2>&1; then
  log "connection 'Username-Password-Authentication' already present — skipping"
else
  if ! auth0 api post connections \
    --data '{"name":"Username-Password-Authentication","strategy":"auth0"}' >/dev/null; then
    log "error: failed to create connection 'Username-Password-Authentication'"
    exit 1
  fi
  log "created connection 'Username-Password-Authentication'"
fi

# Resolve the connection ID — used both to echo it and to reset passkey_options.
CONN_ID=$(auth0 api get "connections?name=Username-Password-Authentication" 2>/dev/null | jq -r '.[0].id // empty')
if [ -z "$CONN_ID" ]; then
  log "error: could not resolve connection id"
  exit 1
fi

# Echo the connection ID so agents don't have to parse the `connections list`
# table output, which truncates long IDs and causes read/write failures.
log "database connection id: $CONN_ID"

# Reset passkey_options to a known baseline so graders are meaningful across
# repeated runs. Without this, tenants carry state from prior runs:
# - local_enrollment_enabled defaults to true → agents preserve it, tripping L2
# - progressive_enrollment_enabled stays true → agents skip setting it, evading L4
EXISTING_OPTIONS=$(auth0 api get "connections/$CONN_ID" 2>/dev/null | jq '.options // {}')
PATCHED_OPTIONS=$(echo "$EXISTING_OPTIONS" | jq '
  .passkey_options.local_enrollment_enabled = false |
  .passkey_options.progressive_enrollment_enabled = false |
  .authentication_methods.passkey.enabled = false
')
if auth0 api patch "connections/$CONN_ID" \
  --data "{\"options\":$PATCHED_OPTIONS}" >/dev/null 2>&1; then
  log "reset passkey_options to baseline (passkey disabled, local_enrollment_enabled=false, progressive_enrollment_enabled=false)"
else
  log "warn: could not reset passkey_options — graders may produce false negatives"
fi

log "done: prerequisites ready"

rm -f -- "$0"
exit 0
