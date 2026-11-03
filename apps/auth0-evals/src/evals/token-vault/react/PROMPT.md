---
id: react_token_vault
name: React Token Vault (Connected Accounts)
scaffold: src/evals/scaffolds/react/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## System

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com

The tenant is already configured: Token Vault is enabled for the `google-oauth2` connection (Connected Accounts, offline access), and the application is allowed to perform the Token Vault exchange.

## Task

My React app already has Auth0 login working. We want to show signed-in users their upcoming Google Calendar events using Token Vault. Our backend at `https://api.barkbook.com/calendar` already reads the calendar on the user's behalf, so the frontend only needs to let the user connect their Google account (connection `google-oauth2`, read-only calendar access via `https://www.googleapis.com/auth/calendar.readonly`).

Add a "Connect Google Calendar" button that links the signed-in user's Google account, and when they come back to the app, show which account was connected.
