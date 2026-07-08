---
id: mfa_tenant_cli
name: MFA Tenant Config (CLI)
category: mfa
skills: auth0-mfa
---

## Task

Our Auth0 tenant is configured operationally through the Auth0 CLI. We need to require multi-factor authentication for step-up flows — a factor being available is not enough; MFA must actually be enforced.

Using the Auth0 CLI, enable the required MFA factor on the tenant and then enforce MFA so it is required for users. Do not configure the tenant through the dashboard or Terraform — the change must be made via the Auth0 CLI.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
