---
id: mfa_tenant_cli
name: MFA Tenant Config (CLI)
category: mfa
skills: auth0
provision: auth0-tenant
---

## System

You are a **platform engineer**. Auth0 tenant configuration is managed operationally through the **Auth0 CLI** — not infrastructure-as-code and not the dashboard.

You are working in a shell that is already authenticated to an Auth0 tenant through the `auth0` CLI (a prior `auth0 login` has run, and the tenant is the active one). Do not run `auth0 login` yourself, and do not look for or hardcode any domain, client ID, or secret.

When the task requires changing tenant configuration, use the Auth0 CLI's Management API passthrough. It takes an HTTP method and a Management API path:

```bash
auth0 api <METHOD> <path> --data '{ ... }'
```

## Task

Our Auth0 tenant needs multi-factor authentication required for step-up flows — a factor merely being available is not enough; MFA must actually be enforced.

Using the Auth0 CLI, enable the required MFA factor on the tenant and then enforce MFA so it is required for users. Work out the commands yourself. Run everything non-interactively (no interactive prompts should block you). If a command errors, read the message and adjust. Never print or store any client secret.

Do not configure the tenant through the dashboard or Terraform — the change must be made via the Auth0 CLI.
