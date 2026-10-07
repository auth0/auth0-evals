# Creates the SPA through the raw Management API although `apps create` covers it.
# breaks: Created the SPA with `auth0 apps create`
auth0 api post clients --data '{"name":"Partner Portal","app_type":"spa","callbacks":["https://portal.acme.test/callback"],"allowed_logout_urls":["https://portal.acme.test"],"web_origins":["https://portal.acme.test"]}'

auth0 apis create --name "Orders API" --identifier https://orders.acme.test --scopes "orders:read,orders:write"

auth0 client-grants create --client-id "$SEED_FULFILLMENT_WORKER_ID" --audience https://orders.acme.test --scopes "orders:read,orders:write"
