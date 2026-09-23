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
if auth0 api get "connections?name=Username-Password-Authentication" | jq -e '.[0]' >/dev/null 2>&1; then
  log "connection 'Username-Password-Authentication' already present — skipping"
else
  if ! auth0 api post connections \
    --data '{"name":"Username-Password-Authentication","strategy":"auth0"}' >/dev/null; then
    log "error: failed to create connection 'Username-Password-Authentication'"
    exit 1
  fi
  log "created connection 'Username-Password-Authentication'"
fi

log "done: prerequisites ready"

rm -f -- "$0"
exit 0
