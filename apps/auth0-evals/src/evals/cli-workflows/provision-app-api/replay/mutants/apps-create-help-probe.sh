# Looks at `apps create --help`, then creates the SPA with the raw Management API instead of the typed command.
# breaks: Created the SPA with `auth0 apps create`
auth0 apps create --help

auth0 api post clients --data '{"name":"Partner Portal","app_type":"spa","token_endpoint_auth_method":"none","callbacks":["https://portal.acme.test/callback"],"allowed_logout_urls":["https://portal.acme.test"],"web_origins":["https://portal.acme.test"]}'

auth0 apis create --name "Orders API" --identifier https://orders.acme.test --scopes "orders:read,orders:write"

auth0 client-grants create --client-id "$SEED_FULFILLMENT_WORKER_ID" --audience https://orders.acme.test --scopes "orders:read,orders:write"
