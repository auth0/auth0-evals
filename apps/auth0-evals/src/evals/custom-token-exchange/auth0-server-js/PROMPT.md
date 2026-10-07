---
id: auth0_server_js_custom_token_exchange
name: auth0-server-js Custom Token Exchange
scaffold: src/evals/scaffolds/auth0-server-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our Express web app already has Auth0 login working via `@auth0/auth0-server-js`. We also integrate
with a partner identity provider that hands us its own short-lived token for an already-signed-in
user. Add a `/partner-login` route that trades that partner token for Auth0 tokens and establishes
the user's Auth0 session, so the rest of the app treats them as logged in — without sending them
through a second interactive login.

Our tenant is already set up to accept these partner tokens: the token type is
`urn:barkbook:external-idp-token`.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
