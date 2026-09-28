---
id: express_api_organizations
name: Express API Organizations
scaffold: src/evals/scaffolds/express-api/auth0
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## Task

My Express API is already protected with `express-oauth2-jwt-bearer`. Add Auth0 Organizations support:

1. Restrict `GET /api/org/members` to users in the "Acme" org (`org_barkbook_acme`)
2. Add `GET /api/org/profile` that returns the organization the signed-in user belongs to (the `org_id` from their token)

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

There is a `.env.example` in the project — create the real `.env` from it with the values above.

