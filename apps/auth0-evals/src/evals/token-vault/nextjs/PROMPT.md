---
id: nextjs_token_vault
name: Next.js App Router Token Vault (Google Calendar)
scaffold: src/evals/scaffolds/nextjs/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## System

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Audience: https://api.barkbook.com

The Auth0 config is already in `.env.local`; read it from the environment rather than hardcoding it.

The tenant is already configured: Token Vault is enabled for the `google-oauth2` connection (Connected Accounts, offline access), and the application is allowed to perform the Token Vault exchange.

## Task

My Next.js App Router app already has Auth0 login working through `@auth0/nextjs-auth0` v4, and signed-in users land on `/dashboard`. I want to use Auth0 Token Vault so the dashboard can show the user's upcoming Google Calendar events.

Add a "Connect Google Calendar" action on the dashboard that lets a signed-in user connect their Google account (connection `google-oauth2`) with calendar read access. Once connected, the dashboard should list their upcoming events from the Google Calendar API, fetched on the server. Nothing Google-token related should reach the browser — and if the Google token can't be obtained, show the user a way to reconnect instead of crashing.
