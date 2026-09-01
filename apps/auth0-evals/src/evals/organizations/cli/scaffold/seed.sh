#!/usr/bin/env bash
# Seeds the throwaway tenant with the prerequisites this task assumes already
# exist: a Single Page Application to configure, and the default database
# connection to enable for the organization.
#
# Runs before the agent, in the same container the `auth0` CLI is authenticated
# into (see docs/ADDING_EVALS.md — "Seeding prerequisites for CLI evals").
#
# Must be idempotent: never assume a pristine tenant, and never abort the run on
# an "already exists" — hence `set -uo pipefail` (not `-e`) and check-or-create.
set -uo pipefail

# Progress goes to stderr, which the framework inherits into the run / CI job
# log (spawnSync stdio: 'inherit'). These lines survive the self-delete below,
# so the log is how you confirm later that the seed ran and what it did.
log() { echo "[seed] $*" >&2; }

log "start: seeding tenant prerequisites"

# Default database connection (normally auto-created with a tenant, but seed
# defensively — some provisioned tenants come up bare).
if auth0 api get "connections?name=Username-Password-Authentication" | jq -e '.[0]' >/dev/null 2>&1; then
  log "connection 'Username-Password-Authentication' already present — skipping"
else
  auth0 api post connections \
    --data '{"name":"Username-Password-Authentication","strategy":"auth0"}' >/dev/null
  log "created connection 'Username-Password-Authentication'"
fi

# A Single Page Application for the agent to configure org login on.
if auth0 apps list | jq -e '.[] | select(.app_type=="spa")' >/dev/null 2>&1; then
  log "a Single Page Application already exists — skipping"
else
  auth0 apps create --name "Acme SPA" --type spa --auth-method None \
    --callbacks "http://localhost:3000" \
    --logout-urls "http://localhost:3000" \
    --origins "http://localhost:3000" >/dev/null
  log "created Single Page Application 'Acme SPA'"
fi

log "done: prerequisites ready"

# Remove self so the agent never sees this script (keeps it out of the agent's
# view and out of the grading corpus). The [seed] log lines above are already
# emitted, so this does not cost us the trace.
rm -f -- "$0"
exit 0
