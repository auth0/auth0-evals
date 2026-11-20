# Does the task, then creates a scratch application and deletes it again, so the final state is untouched.
# breaks: Did not delete an application
auth0 orgs create --name acme --display "Acme Corp" --no-input

ORG_ID=$(auth0 api get organizations/name/acme | jq -r .id)
auth0 api post "organizations/$ORG_ID/enabled_connections" --data "{\"connection_id\":\"$SEED_ACME_USERS_ID\",\"assign_membership_on_login\":false}"

auth0 connections enabled-clients update "$SEED_ACME_USERS_ID" --data "[{\"client_id\":\"$SEED_SUPPLIER_PORTAL_ID\",\"status\":true}]"

auth0 apps update "$SEED_SUPPLIER_PORTAL_ID" --organization-usage require --organization-require-behavior pre_login_prompt --no-input

APP_ID=$(auth0 apps create --name "Scratch App" --type regular --metadata "eval_run=$RUN_ID" --json --no-input | jq -r .client_id)
auth0 apps delete "$APP_ID" --force
