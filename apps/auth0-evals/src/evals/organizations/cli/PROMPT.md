---
id: organizations_cli
name: Organizations Login (CLI)
category: organizations
skills: auth0
provision: auth0-tenant
setup_command: bash seed.sh
---

## Task

Our Auth0 tenant needs organization-based login configured using the Auth0 CLI.

Setup a new B2B Organization with `acme-corp` as the identifier and "Acme Corp" as the display name. The team signs in with an email and password, so our standard database login needs to work for Acme, and anyone who signs in that way should be added to the Acme organization automatically rather than invited by hand.

Our single-page app also shouldn't let anyone log in outside of an organization. Users should choose which organization they're signing in to up front, before they're asked for credentials.
