#!/usr/bin/env bash
# Seeds the throwaway tenant with the prerequisites this task assumes already
# exist: a custom API to mint access tokens for, a database connection to
# resolve users into, and the machine-to-machine application that will perform
# the exchange. The agent then enables Custom Token Exchange on that app, adds
# the token-validation logic, and registers the token-exchange profile.
#
# Runs before the agent, in the same container the `auth0` CLI is authenticated
# into (see docs/ADDING_EVALS.md — "Seeding prerequisites for CLI evals").
#
# Must be idempotent: never assume a pristine tenant, and never abort the run on
# an "already exists" — hence `set -uo pipefail` (not `-e`) and check-or-create.
set -uo pipefail

log() { echo "[seed] $*" >&2; }

log "start: seeding tenant prerequisites"

# Custom API the exchanged tokens are minted for.
if auth0 apis list --json | jq -e '.[] | select(.identifier=="https://api.barkbook.com")' >/dev/null 2>&1; then
  log "resource server 'https://api.barkbook.com' already present — skipping"
else
  if ! auth0 api post resource-servers \
    --data '{"name":"Barkbook API","identifier":"https://api.barkbook.com","signing_alg":"RS256"}' >/dev/null; then
    log "error: failed to create resource server 'https://api.barkbook.com'"
    exit 1
  fi
  log "created resource server 'https://api.barkbook.com'"
fi

# Default database connection the exchange logic resolves users into.
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

# The machine-to-machine application that performs the exchange.
if auth0 apps list --json | jq -e '.[] | select(.name=="Partner Exchange")' >/dev/null 2>&1; then
  log "application 'Partner Exchange' already exists — skipping"
else
  if ! auth0 apps create --name "Partner Exchange" --type m2m \
    --description "Performs Custom Token Exchange for partner tokens" >/dev/null; then
    log "error: failed to create application 'Partner Exchange'"
    exit 1
  fi
  log "created application 'Partner Exchange'"
fi

log "done: prerequisites ready"

rm -f -- "$0"
exit 0
