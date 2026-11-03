---
id: auth0_api_js_token_vault
name: auth0-api-js Token Vault (Google Calendar)
scaffold: src/evals/scaffolds/auth0-api-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## System

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw

The Client ID and Client Secret belong to the API's own Auth0 application (its Custom API Client). Put any new configuration in the environment alongside the existing `AUTH0_DOMAIN` and `AUTH0_AUDIENCE`.

The tenant is already configured: Token Vault is enabled for the `google-oauth2` connection (Connected Accounts, offline access), and the application is allowed to perform the Token Vault exchange.

## Task

Our Express API already verifies Auth0 access tokens using `@auth0/auth0-api-js`. Our users have connected their Google accounts through Auth0 (connection `google-oauth2`), and Token Vault holds their Google tokens.

Add a `GET /api/calendar` route. Our SPA calls it with the same Auth0 access token it sends to the other routes, and the API should respond with that user's upcoming Google Calendar events.
