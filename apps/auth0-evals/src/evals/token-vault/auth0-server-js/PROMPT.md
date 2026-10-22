---
id: auth0_server_js_token_vault
name: auth0-server-js Token Vault (Google Calendar)
scaffold: src/evals/scaffolds/auth0-server-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## System

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Audience: https://api.barkbook.com
Base URL: http://localhost:3000

The tenant is already configured: Token Vault is enabled for the `google-oauth2` connection (Connected Accounts, offline access), and the application is allowed to perform the Token Vault exchange.

## Task

Barkbook's Express web app already signs users in through `@auth0/auth0-server-js` and keeps them in a session, and most of our users log in with Google (the `google-oauth2` connection). We want to show them their schedule.

Add a `GET /calendar` route that returns the signed-in user's upcoming Google Calendar events. Use Auth0 Token Vault to get the user's Google access token on the server — we don't want to store Google tokens ourselves. If the app can't get a Google token for the user, send them back through login instead of crashing.
