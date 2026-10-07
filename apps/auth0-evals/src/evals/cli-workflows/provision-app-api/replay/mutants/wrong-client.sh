# Grants the API to Legacy Admin instead of Fulfillment Worker.
# breaks: Fulfillment Worker is granted both Orders API permissions
# breaks: No other application was granted the Orders API
auth0 apps create --name "Partner Portal" --type spa --callbacks https://portal.acme.test/callback --logout-urls https://portal.acme.test --web-origins https://portal.acme.test

auth0 apis create --name "Orders API" --identifier https://orders.acme.test --scopes "orders:read,orders:write"

auth0 client-grants create --client-id "$SEED_LEGACY_ADMIN_ID" --audience https://orders.acme.test --scopes "orders:read,orders:write"
