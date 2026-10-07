# Also adds a default grant for third-party clients on the Orders API.
# breaks: No other application was granted the Orders API
auth0 apps create --name "Partner Portal" --type spa --callbacks https://portal.acme.test/callback --logout-urls https://portal.acme.test --web-origins https://portal.acme.test

auth0 apis create --name "Orders API" --identifier https://orders.acme.test --scopes "orders:read,orders:write"

auth0 client-grants create --client-id "$SEED_FULFILLMENT_WORKER_ID" --audience https://orders.acme.test --scopes "orders:read,orders:write"

auth0 client-grants create --default-for third_party_clients --audience https://orders.acme.test --scopes "orders:read,orders:write"
