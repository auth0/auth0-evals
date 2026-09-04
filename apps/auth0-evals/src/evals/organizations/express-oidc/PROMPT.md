---
id: express_oidc_organizations
name: Express OIDC Organizations Login
scaffold: src/evals/scaffolds/express-oidc/auth0
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## Task

Our Express web app already has Auth0 login working via `express-openid-connect`. Add Auth0
Organizations support: log users in to our "Acme" org (`org_barkbook_acme`), accept organization
invitation links (`?invitation=...&organization=...`), and show which organization the signed-in
user belongs to.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
