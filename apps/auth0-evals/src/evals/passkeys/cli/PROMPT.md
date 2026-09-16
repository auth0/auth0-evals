---
id: passkeys_cli
name: Passkeys Config (CLI)
category: passkeys
skills: auth0
provision: auth0-tenant
---

## Task

We'd like our users to be able to sign up and log in with passkeys instead of passwords. Can you turn that on for our tenant's database login?

A couple of things we care about:

- We want existing users to be nudged to set up a passkey over time, not just brand-new sign-ups.
- Please be careful not to disturb the other settings on that login connection — we've got password rules and other config we don't want reset.

Please set this up using the Auth0 CLI only — no dashboard clicking and no Terraform.
