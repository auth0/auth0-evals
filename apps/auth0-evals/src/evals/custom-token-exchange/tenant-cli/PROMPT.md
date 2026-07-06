---
id: cte_tenant_cli
name: Custom Token Exchange Tenant Config (CLI)
category: custom-token-exchange
scaffold: src/evals/scaffolds/cli/cte
skills: auth0-custom-token-exchange
---

## Task

Our Auth0 tenant is configured operationally through the Auth0 CLI. We are enabling **Custom Token Exchange** (RFC 8693) so a server can exchange an external `subject_token` for an Auth0 access token.

Using the Auth0 CLI, set up the tenant so custom token exchange works end-to-end: an incoming external token must be validated before Auth0 issues a token, and the exchange must be bound to the external token type our application will send. Make sure the validation logic is actually live, not left in a draft state.

Do not configure the tenant through the dashboard or Terraform — the change must be made via the Auth0 CLI.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
