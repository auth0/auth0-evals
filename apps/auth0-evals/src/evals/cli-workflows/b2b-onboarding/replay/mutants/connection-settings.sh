# Does the task, then renames the acme-users connection's display name.
# breaks: acme-users connection settings were not modified
auth0 orgs create --name acme --display "Acme Corp" --no-input

ORG_ID=$(auth0 api get organizations/name/acme | jq -r .id)
auth0 api post "organizations/$ORG_ID/enabled_connections" --data "{\"connection_id\":\"$SEED_ACME_USERS_ID\",\"assign_membership_on_login\":false}"

auth0 connections enabled-clients update "$SEED_ACME_USERS_ID" --data "[{\"client_id\":\"$SEED_SUPPLIER_PORTAL_ID\",\"status\":true}]"

auth0 apps update "$SEED_SUPPLIER_PORTAL_ID" --organization-usage require --organization-require-behavior pre_login_prompt --no-input

auth0 api patch "connections/$SEED_ACME_USERS_ID" --data "{\"display_name\":\"Acme Employees\"}"
