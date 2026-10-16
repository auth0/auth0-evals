---
id: mfa_cli
name: MFA Config (CLI)
displayable_prompt: Configure SMS phone and email MFA factors on an Auth0 tenant via the CLI and enforce MFA for all users across all applications.
category: mfa
skills: auth0
provision: auth0-tenant
---

## Task

Our Auth0 tenant needs two MFA channels configured and enforced:

**1. Phone (SMS) factor**
- Enable the SMS factor on the tenant.
- Set the message type to SMS (not voice).
- Configure the phone provider. Use Auth0's built-in provider (suitable for testing).

**2. Email factor**
- Enable the email factor on the tenant.
- Note: Auth0 requires at least one other factor to be enabled before email can be enabled.

Finally, enforce MFA across all applications so it is required for every user — a factor merely being available is not enough.
