---
id: custom_token_exchange_nextjs_enterprise
name: Custom Token Exchange — Next.js (Enterprise)
scaffold: src/evals/custom-token-exchange/nextjs-enterprise
skills: auth0-custom-token-exchange
setup_command: npm install
compile_command: npm run build
---

## Task

Our Next.js app needs to accept partner SSO tokens from Apex Corp and exchange them for Auth0 access tokens for our internal API. Build a Route Handler at `/api/partner/exchange` that accepts a partner token in the request body and returns an Auth0 access token.

Partner tokens use the identifier `urn:apexcorp:sso-token`. Check the existing infrastructure before making changes.

Domain: dev-meridian.us.auth0.com
Client ID: meridian_client_mno345pqr
Client Secret: meridian_secret_stu678vwx
Audience: https://api.meridian.com

Do not prompt for permissions to create any .env or .env.local files.
