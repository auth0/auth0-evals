# Never enables acme-users on the organization, so Acme members have no way to sign in.
# breaks: Acme organization has exactly the acme-users connection enabled
auth0 orgs create --name acme --display "Acme Corp" --no-input

auth0 connections enabled-clients update "$SEED_ACME_USERS_ID" --data "[{\"client_id\":\"$SEED_SUPPLIER_PORTAL_ID\",\"status\":true}]"

auth0 apps update "$SEED_SUPPLIER_PORTAL_ID" --organization-usage require --organization-require-behavior pre_login_prompt --no-input
