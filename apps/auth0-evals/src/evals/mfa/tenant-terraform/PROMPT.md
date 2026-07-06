---
id: mfa_tenant_terraform
name: MFA Tenant Config (Terraform)
category: mfa
scaffold: src/evals/scaffolds/terraform/auth0
skills: auth0-mfa
---

## Task

Our Auth0 tenant is managed as infrastructure-as-code with the Auth0 Terraform provider in `infra/auth0/main.tf`. We need to require multi-factor authentication for step-up flows.

Enable the required MFA factor on the tenant by adding the appropriate Guardian resource to `infra/auth0/main.tf`. Do not configure the tenant through the dashboard or the Auth0 CLI — the change must live in the Terraform configuration.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
