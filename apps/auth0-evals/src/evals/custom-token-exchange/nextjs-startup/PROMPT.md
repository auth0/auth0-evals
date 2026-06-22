---
id: custom_token_exchange_nextjs_startup
name: Custom Token Exchange — Next.js (Startup)
scaffold: src/evals/custom-token-exchange/nextjs-startup
skills: auth0-custom-token-exchange
setup_command: npm install
compile_command: npm run build
---

## Task

Our Next.js app already has Auth0 login set up. We're migrating users from a legacy auth system and can't force everyone to re-login immediately. Build a Route Handler at `/api/exchange-token` that accepts a legacy token in the request body and returns an Auth0 access token so those users can call our new API.

Legacy tokens use the identifier `urn:nexuspay:legacy-token`. The legacy system is already issuing them — you just need to configure Auth0 to accept and validate them, then wire up the exchange endpoint.

Domain: dev-nexuspay.us.auth0.com
Client ID: nexuspay_client_abc789def
Client Secret: nexuspay_secret_ghi012jkl
Audience: https://api.nexuspay.com

Do not prompt for permissions to create any .env or .env.local files.
