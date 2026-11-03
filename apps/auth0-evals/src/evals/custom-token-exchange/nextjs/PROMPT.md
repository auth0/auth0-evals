---
id: nextjs_custom_token_exchange
name: Next.js App Router Custom Token Exchange
scaffold: src/evals/scaffolds/nextjs/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

My Next.js App Router app already has Auth0 login set up using `@auth0/nextjs-auth0` v4. A partner backend calls one of our Route Handlers with its own short-lived token identifying an already-authenticated user. On the server, I want to trade that partner token for an Auth0 access token for our API so the handler can call downstream services on the user's behalf. This is a server-to-server step — nothing should reach the browser.

Our tenant is already set up to accept these partner tokens: the token type is `urn:barkbook:external-idp-token`. Add a Route Handler that performs the exchange and returns a success/failure status to the caller.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Audience: https://api.barkbook.com
