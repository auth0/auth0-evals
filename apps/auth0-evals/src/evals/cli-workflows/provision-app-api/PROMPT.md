---
id: provision_app_api_cli
name: Provision an Application and API (CLI Workflow)
category: cli-workflows
skills: auth0
provision: auth0-tenant
---

## Task

We're launching the Partner Portal, a single-page app, along with the Orders API it calls. Please set both up on our Auth0 tenant.

- The Partner Portal app should be named "Partner Portal". Its callback URL is `https://portal.acme.test/callback`, its allowed logout URL is `https://portal.acme.test`, and its allowed web origin is `https://portal.acme.test`.
- The API should be named "Orders API" with the identifier `https://orders.acme.test`. It needs two permissions, `orders:read` and `orders:write`.
- Our existing "Fulfillment Worker" machine-to-machine app needs to call the Orders API with both permissions.

Leave every other application on the tenant as it is.
