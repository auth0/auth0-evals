---
id: token_vault_cli
name: Token Vault Setup (CLI)
category: token-vault
skills: auth0
provision: auth0-tenant
setup_command: bash seed.sh
---

## Task

Our web app "Barkbook Web" (an existing Regular Web Application on this tenant) lets users sign in with Google through the tenant's existing `google-oauth2` connection.

We're adding a feature that reads each signed-in user's Google Calendar from our backend. After login the backend holds the user's Auth0 refresh token, and it should hand that refresh token to Auth0 and get back the user's Google access token. Auth0 should store and refresh the Google tokens for us — we never want to keep Google tokens ourselves.

Using the Auth0 CLI only, set the tenant up so this exchange works:

- the `google-oauth2` connection must keep users' Google tokens so they can be retrieved later,
- "Barkbook Web" must be allowed to perform the exchange, without losing the sign-in and refresh capabilities it already has,
- and the app's refresh-token settings must be compatible with this exchange.

The Google Cloud console side is handled separately, and you do not need to set up Connected Accounts, the My Account API, or any application code — stop once the tenant is configured.
