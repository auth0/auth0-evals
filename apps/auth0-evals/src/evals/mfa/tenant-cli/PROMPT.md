---
id: mfa_tenant_cli
name: MFA Tenant Config (CLI)
category: mfa
skills: auth0
provision: auth0-tenant
---

## Task

Our Auth0 tenant needs multi-factor authentication required for step-up flows — a factor merely being available is not enough; MFA must actually be enforced.

Using the Auth0 CLI, enable the required MFA factor on the tenant and then enforce MFA so it is required for users. Work out the commands yourself. Run everything non-interactively (no interactive prompts should block you). If a command errors, read the message and adjust. Never print or store any client secret.

Do not configure the tenant through the dashboard or Terraform — the change must be made via the Auth0 CLI.
