---
id: cli_resource_server_scopes
name: Resource Server & Scopes (CLI)
category: cli
skills: auth0
provision: auth0-tenant
---

## Task

We are shipping a new Orders API and need Auth0 to issue and authorize access tokens for it.

Using the Auth0 CLI, register the API on this tenant:

- Create the API (resource server) with the identifier (audience) `https://api.acme.test/orders`.
- Define the scopes `read:orders` and `write:orders` on it.
- Turn on RBAC for this API so that permissions are enforced and the granted permissions are included in the issued access tokens.

The end state should be an API that enforces role-based permissions, not just a plain resource server with scopes listed but no enforcement.
