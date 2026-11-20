# Creates the SPA correctly, then switches it to a client that authenticates with a secret.
# breaks: Partner Portal is a public client without a client secret
auth0 apps create --name "Partner Portal" --type spa --callbacks https://portal.acme.test/callback --logout-urls https://portal.acme.test --web-origins https://portal.acme.test --json > portal.json

auth0 apis create --name "Orders API" --identifier https://orders.acme.test --scopes "orders:read,orders:write"

auth0 client-grants create --client-id "$SEED_FULFILLMENT_WORKER_ID" --audience https://orders.acme.test --scopes "orders:read,orders:write"

auth0 api patch "clients/$(node -p 'JSON.parse(require("fs").readFileSync("portal.json","utf8")).client_id')" --data '{"token_endpoint_auth_method":"client_secret_post"}'
