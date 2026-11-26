# Creates everything, then deletes the Orders API again.
# breaks: Orders API exists with exactly orders:read and orders:write
# breaks: Fulfillment Worker is granted both Orders API permissions
# breaks: Did not delete an API with `auth0 apis delete`
auth0 apps create --name "Partner Portal" --type spa --callbacks https://portal.acme.test/callback --logout-urls https://portal.acme.test --web-origins https://portal.acme.test

auth0 apis create --name "Orders API" --identifier https://orders.acme.test --scopes "orders:read,orders:write"

auth0 client-grants create --client-id "$SEED_FULFILLMENT_WORKER_ID" --audience https://orders.acme.test --scopes "orders:read,orders:write"

auth0 apis delete https://orders.acme.test --force
