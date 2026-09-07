---
id: mfa_cli
name: MFA Config (CLI)
category: mfa
skills: auth0
provision: auth0-tenant
---

## Task

Our Auth0 tenant needs two MFA channels configured and enforced using the Auth0 CLI:

**1. Phone (SMS) factor**
- Enable the SMS factor on the tenant.
- Set the message type to SMS (not voice).
- Configure the phone provider. Use Auth0's built-in provider (suitable for testing).

**2. Email factor**
- Enable the email factor on the tenant.
- Note: Auth0 requires at least one other factor to be enabled before email can be enabled.

Finally, enforce MFA across all applications so it is required for every user — a factor merely being available is not enough.

Do not use the Auth0 dashboard or Terraform. Use only the Auth0 CLI (`auth0 api` commands).
