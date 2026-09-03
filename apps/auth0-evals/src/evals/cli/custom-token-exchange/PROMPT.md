---
id: cli_custom_token_exchange
name: Custom Token Exchange (CLI)
category: cli
skills: auth0
provision: auth0-tenant
---

## Task

We are migrating a legacy service that mints its own opaque session tokens. We want that service to be able to trade one of its legacy tokens for an Auth0-issued access token using Custom Token Exchange, so the legacy token never has to be trusted directly by downstream APIs.

Using the Auth0 CLI, set up Custom Token Exchange on this tenant end to end:

- Create an Action bound to the Custom Token Exchange trigger that validates the incoming legacy token and sets the resulting Auth0 user.
- Deploy that Action so it is live, not just a draft.
- Create a token exchange profile that ties a custom subject token type to the deployed Action so the exchange endpoint knows to run it.

The exchange must actually be usable after you finish, not just partially wired.
