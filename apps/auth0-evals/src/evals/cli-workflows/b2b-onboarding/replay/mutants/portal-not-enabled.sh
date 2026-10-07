# Enables the connection on the organization but never lets the portal use it.
# breaks: Supplier Portal is enabled on the acme-users connection
auth0 orgs create --name acme --display "Acme Corp" --no-input

ORG_ID=$(auth0 api get organizations/name/acme | jq -r .id)
auth0 api post "organizations/$ORG_ID/enabled_connections" --data "{\"connection_id\":\"$SEED_ACME_USERS_ID\",\"assign_membership_on_login\":false}"

auth0 apps update "$SEED_SUPPLIER_PORTAL_ID" --organization-usage require --organization-require-behavior pre_login_prompt --no-input
