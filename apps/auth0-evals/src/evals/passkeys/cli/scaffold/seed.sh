#!/usr/bin/env bash
# Seeds the throwaway tenant with the prerequisites this task assumes already
# exist: a custom domain (passkeys require one) and a database connection for
# the agent to enable passkeys on.
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

# Custom domain — passkeys require one so enrolled credentials stay bound to a
# stable domain. Seed it so the agent's task is purely enabling passkeys.
# Non-fatal: if the tenant plan doesn't support custom domains, log and move on.
DOMAIN="login.dev-barkbook.com"
CD_LOOKUP=$(auth0 api get custom-domains 2>/dev/null)
if echo "$CD_LOOKUP" | jq -e --arg d "$DOMAIN" '.[]? | select(.domain == $d)' >/dev/null 2>&1; then
  log "custom domain '$DOMAIN' already present — skipping"
elif auth0 api post custom-domains \
  --data "{\"domain\":\"$DOMAIN\",\"type\":\"auth0_managed_certs\"}" >/dev/null 2>&1; then
  log "created custom domain '$DOMAIN'"
else
  log "warn: could not create custom domain '$DOMAIN' (tenant plan may not support it) — continuing"
fi

log "done: prerequisites ready"

rm -f -- "$0"
exit 0
