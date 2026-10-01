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

# Echo the connection ID so agents don't have to parse the `connections list`
# table output, which truncates long IDs and causes read/write failures.
CONN_ID=$(auth0 api get "connections?name=Username-Password-Authentication" 2>/dev/null | jq -r '.[0].id // empty')
if [ -n "$CONN_ID" ]; then
  log "database connection id: $CONN_ID"
fi

log "done: prerequisites ready"

rm -f -- "$0"
exit 0
