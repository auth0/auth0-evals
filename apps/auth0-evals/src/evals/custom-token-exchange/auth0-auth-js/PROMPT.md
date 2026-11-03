---
id: auth0_auth_js_custom_token_exchange
name: auth0-auth-js Custom Token Exchange
scaffold: src/evals/scaffolds/auth0-auth-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our Node.js auth service already uses `@auth0/auth0-auth-js` for its login flow. A partner backend
sends us its own short-lived token identifying an already-authenticated user. We want a
`/auth/partner` endpoint that trades that partner token for Auth0 tokens for our API and returns the
access token to the trusted caller. This is a direct token-for-token step — not an interactive login
and not a federated-connection lookup.

Our tenant is already set up to accept these partner tokens: the token type is
`urn:barkbook:external-idp-token`.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
