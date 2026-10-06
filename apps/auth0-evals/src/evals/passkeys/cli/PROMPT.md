---
id: passkeys_cli
name: Passkeys Config (CLI)
displayable_prompt: Enable passkeys on an Auth0 tenant's database connection via CLI with progressive enrollment, without disturbing existing connection settings.
category: passkeys
skills: auth0
provision: auth0-tenant
setup_command: bash seed.sh
---

## Task

We'd like our users to be able to sign up and log in with passkeys instead of passwords. The custom domain that passkeys require is handled separately — **do not create, configure, or verify a custom domain as part of this task.**

Please enable passkeys on the tenant's database connection using the Auth0 CLI only.

A couple of things we care about:

- We want existing users to be nudged to set up a passkey over time, not just brand-new sign-ups.
- Please be careful not to disturb the other settings on that login connection — we've got password rules and other config we don't want reset.

