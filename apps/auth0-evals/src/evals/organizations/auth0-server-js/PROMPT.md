---
id: auth0_server_js_organizations
name: auth0-server-js Organizations Login
scaffold: src/evals/scaffolds/auth0-server-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our Express web app already has Auth0 login working via `@auth0/auth0-server-js`. Add Auth0
Organizations support: log users in to our "Acme" org (`org_barkbook_acme`), accept organization
invitation links, handle `OrganizationValidationError` when org claim validation fails, and show which organization the signed-in user belongs to.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
