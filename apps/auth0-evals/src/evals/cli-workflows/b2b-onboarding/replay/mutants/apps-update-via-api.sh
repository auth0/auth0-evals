# Correct final state, but sets the organization settings with a raw API call when `auth0 apps update` exists.
# breaks: Set the organization settings with `auth0 apps update`
auth0 orgs create --name acme --display "Acme Corp" --no-input

ORG_ID=$(auth0 api get organizations/name/acme | jq -r .id)
auth0 api post "organizations/$ORG_ID/enabled_connections" --data "{\"connection_id\":\"$SEED_ACME_USERS_ID\",\"assign_membership_on_login\":false}"

auth0 connections enabled-clients update "$SEED_ACME_USERS_ID" --data "[{\"client_id\":\"$SEED_SUPPLIER_PORTAL_ID\",\"status\":true}]"

auth0 api patch "clients/$SEED_SUPPLIER_PORTAL_ID" --data "{\"organization_usage\":\"require\",\"organization_require_behavior\":\"pre_login_prompt\"}"
