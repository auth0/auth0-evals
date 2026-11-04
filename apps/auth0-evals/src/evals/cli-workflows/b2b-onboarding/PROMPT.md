---
id: b2b_onboarding_cli
name: Onboard a B2B Customer Organization (CLI Workflow)
category: cli-workflows
skills: auth0
provision: auth0-tenant
---

## Task

Acme Corp is the first business customer of our Supplier Portal, and we need to onboard them on our Auth0 tenant.

- Create an organization for them with the name `acme` and the display name "Acme Corp".
- Acme's employees sign in with our existing `acme-users` database connection. Enable that connection for the Acme organization, and make sure the "Supplier Portal" application can use it.
- The Supplier Portal should only let people sign in through an organization, and it should ask for their organization before showing the login page.

Leave the Globex organization, the Ops Console application, and every other setting on the tenant as they are.
