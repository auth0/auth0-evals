---
id: cte_tenant_terraform
name: Custom Token Exchange Tenant Config (Terraform)
category: custom-token-exchange
scaffold: src/evals/scaffolds/terraform/cte
skills: auth0-custom-token-exchange
---

## Task

Our Auth0 tenant is managed as infrastructure-as-code with the Auth0 Terraform provider in `infra/auth0/main.tf`. We are enabling **Custom Token Exchange** (RFC 8693) so a server can exchange an external `subject_token` for an Auth0 access token.

Configure the tenant, in Terraform, so custom token exchange works end-to-end: an incoming external token must be validated before Auth0 issues a token, and the exchange must be bound to the external token type our application will send.

Do not configure the tenant through the dashboard or the Auth0 CLI — the change must live in the Terraform configuration.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
