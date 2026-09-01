---
id: organizations_cli
name: Organizations Login (CLI)
category: organizations
skills: auth0
provision: auth0-tenant
---

## Task

Our Auth0 tenant needs organization-based login configured using the Auth0 CLI. Set up a B2B organization called "Acme Corp" and enable organization login for the tenant's Single Page Application.

- Create an organization with the name `acme-corp` and display name "Acme Corp".
- Enable the tenant's default database connection ("Username-Password-Authentication") for the Acme Corp organization and configure the connection to automatically assign membership when users login with it.
- Configure tenant to require organization login and users should be asked which organization they below to up front, before entering credentials.
