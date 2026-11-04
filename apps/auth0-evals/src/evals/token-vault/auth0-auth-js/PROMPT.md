---
id: auth0_auth_js_token_vault
name: auth0-auth-js Token Vault
scaffold: src/evals/scaffolds/auth0-auth-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## System

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Audience: https://api.barkbook.com

The tenant is already configured: Token Vault is enabled for the `google-oauth2` connection
(Connected Accounts, offline access), and the application is allowed to perform the Token Vault exchange.

## Task

Our Node.js auth service uses `@auth0/auth0-auth-js`. Callers sign in through `/login` and keep the
Auth0 refresh token it hands back. Our users signed in with Google, and we now want to show them their
upcoming Google Calendar events.

Add a `POST /calendar/events` endpoint that takes the caller's Auth0 refresh token and returns the
user's upcoming events from their primary Google Calendar. The server should get the user's Google
access token from Token Vault (connection `google-oauth2`) and call the Google Calendar API itself —
we don't want to store Google tokens ourselves or hand them to the caller.
