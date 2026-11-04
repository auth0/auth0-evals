---
id: spa_js_token_vault
name: SPA JS Token Vault Connected Accounts
scaffold: src/evals/scaffolds/spa-js/auth0
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

My vanilla JavaScript SPA already has Auth0 login working with @auth0/auth0-spa-js. I want signed-in users to see their upcoming Google Calendar events. Add a "Connect Google Calendar" button that lets the user connect their Google account (connection `google-oauth2`, read-only calendar access) through Auth0 Token Vault, and when they come back to the app, show which account was connected. Our Barkbook backend already reads the calendar from Google for a connected user at `https://api.barkbook.com/calendar` — add a way to load and display those events too.
