#!/usr/bin/env bash
# Seeds the throwaway tenant with the prerequisites this task assumes already
# exist: the "Barkbook Web" Regular Web Application and a `google-oauth2`
# connection enabled for it. The agent then enables Token Vault on the
# connection, adds the Token Vault grant to the app, and makes the app's
# refresh tokens non-rotating.
#
# Runs before the agent, in the same container the `auth0` CLI is authenticated
# into (see docs/CLI_CONFIG_EVALS.md — "Seeding tenant prerequisites").
#
# Must be idempotent: never assume a pristine tenant, and never abort the run on
# an "already exists" — hence `set -uo pipefail` (not `-e`) and check-or-create.
set -uo pipefail

log() { echo "[seed] $*" >&2; }

log "start: seeding tenant prerequisites"

# The Regular Web Application the backend exchange runs as.
APPS=$(auth0 apps list --json 2>/dev/null)
if [ $? -ne 0 ]; then
  log "error: failed to list applications — aborting to avoid a spurious duplicate create"
  exit 1
fi
if echo "$APPS" | jq -e '.[] | select(.name=="Barkbook Web")' >/dev/null 2>&1; then
  log "application 'Barkbook Web' already exists — skipping"
else
  if ! auth0 apps create --name "Barkbook Web" --type regular \
    --description "Server-side web app that reads users' Google Calendar" \
    --callbacks "http://localhost:3000/auth/callback" --logout-urls "http://localhost:3000" >/dev/null; then
    log "error: failed to create application 'Barkbook Web'"
    exit 1
  fi
  log "created application 'Barkbook Web'"
fi

APP_ID=$(auth0 apps list --json 2>/dev/null | jq -r '[.[] | select(.name=="Barkbook Web")][0].client_id // empty')
if [ -z "$APP_ID" ]; then
  log "error: could not resolve the 'Barkbook Web' client id"
  exit 1
fi
log "Barkbook Web client id: $APP_ID"

# Reset the app to a known baseline so graders are meaningful across repeated
# runs. Without this, tenants carry state from prior runs:
# - the Token Vault grant stays in grant_types → agents skip adding it, evading L4
# - rotation stays non-rotating → agents skip the refresh-token fix, evading L4
# client_credentials is in the baseline so a PATCH that replaces grant_types
# instead of merging into it visibly drops an existing grant.
if auth0 apps update "$APP_ID" --data '{
  "grant_types": ["authorization_code", "refresh_token", "client_credentials"],
  "refresh_token": {
    "rotation_type": "rotating",
    "expiration_type": "expiring",
    "leeway": 0,
    "token_lifetime": 2592000,
    "infinite_token_lifetime": false,
    "idle_token_lifetime": 1296000,
    "infinite_idle_token_lifetime": false
  }
}' >/dev/null 2>&1; then
  log "reset 'Barkbook Web' to baseline (no Token Vault grant, rotating refresh tokens)"
else
  log "warn: could not reset 'Barkbook Web' — graders may produce false negatives"
fi

# The Google social connection users sign in with. Placeholder Google
# credentials stand in for the Google Cloud console side, which the prompt puts
# out of scope; no login is ever attempted against them.
LOOKUP=$(auth0 connections list --query '{"name":"google-oauth2"}' --json 2>/dev/null)
if [ $? -ne 0 ]; then
  log "error: failed to look up connections — aborting to avoid a spurious duplicate create"
  exit 1
fi
if echo "$LOOKUP" | jq -e '.[0]' >/dev/null 2>&1; then
  log "connection 'google-oauth2' already present — skipping"
else
  if ! auth0 connections create \
    --data '{"name":"google-oauth2","strategy":"google-oauth2","options":{"client_id":"barkbook-web.apps.googleusercontent.com","client_secret":"placeholder-not-a-real-secret","email":true,"profile":true}}' >/dev/null; then
    log "error: failed to create connection 'google-oauth2'"
    exit 1
  fi
  log "created connection 'google-oauth2'"
fi

CONN_ID=$(auth0 connections list --query '{"name":"google-oauth2"}' --json 2>/dev/null | jq -r '.[0].id // empty')
if [ -z "$CONN_ID" ]; then
  log "error: could not resolve the 'google-oauth2' connection id"
  exit 1
fi
log "google-oauth2 connection id: $CONN_ID"

# Users of Barkbook Web sign in through this connection, so enable it for the app.
if auth0 connections enabled-clients update "$CONN_ID" \
  --data "[{\"client_id\":\"$APP_ID\",\"status\":true}]" >/dev/null 2>&1; then
  log "enabled 'google-oauth2' for 'Barkbook Web'"
else
  log "warn: could not enable 'google-oauth2' for 'Barkbook Web'"
fi

# Reset Token Vault on the connection to off — the thing the agent must turn on.
if auth0 connections update "$CONN_ID" --data '{"connected_accounts":{"active":false}}' >/dev/null 2>&1; then
  log "reset 'google-oauth2' to baseline (connected_accounts inactive)"
else
  log "warn: could not reset connected_accounts on 'google-oauth2' — graders may produce false negatives"
fi

log "done: prerequisites ready"

rm -f -- "$0"
exit 0
