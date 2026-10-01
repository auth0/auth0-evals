---
id: custom_token_exchange_cli
name: Custom Token Exchange Setup (CLI)
category: custom-token-exchange
skills: auth0
provision: auth0-tenant
setup_command: bash seed.sh
---

## Task

We're integrating a partner identity provider. The partner issues its own short-lived tokens of type `urn:barkbook:external-idp-token` for users who are already signed in on their side. Our backend holds a machine-to-machine application ("Partner Exchange") and a custom API (`https://api.barkbook.com`), both already created.

We want our backend to hand one of those partner tokens to Auth0 and get back Auth0 tokens for our API — creating or matching the user automatically, with no interactive login.

Set the tenant up so this exchange works end to end:

- our "Partner Exchange" application must be allowed to perform the exchange,
- there must be logic that validates an incoming partner token and resolves it to a user in our `Username-Password-Authentication` database connection,
- and the partner token type `urn:barkbook:external-idp-token` must be registered so Auth0 routes these exchange requests to that logic.
