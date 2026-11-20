# Deletes the Legacy Admin sentinel.
# breaks: Legacy Admin was not modified
# breaks: Did not delete an application with `auth0 apps delete`
auth0 apps create --name "Partner Portal" --type spa --callbacks https://portal.acme.test/callback --logout-urls https://portal.acme.test --web-origins https://portal.acme.test

auth0 apis create --name "Orders API" --identifier https://orders.acme.test --scopes "orders:read,orders:write"

auth0 client-grants create --client-id "$SEED_FULFILLMENT_WORKER_ID" --audience https://orders.acme.test --scopes "orders:read,orders:write"

auth0 apps delete "$SEED_LEGACY_ADMIN_ID" --force
