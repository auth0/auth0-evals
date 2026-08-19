---
id: express_api_rbac
name: Express API RBAC and Scopes
scaffold: src/evals/scaffolds/express-api/auth0
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## Task

My Express API validates Auth0 JWT access tokens with express-oauth2-jwt-bearer. I need finer-grained authorization on top of it.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

I have RBAC enabled on the API in the Auth0 Dashboard, with "Add Permissions in the Access Token" turned on.

Add these routes:
- `POST /api/transfers/bulk` — the caller must have **both** the `write:transfers` and `approve:transfers` scopes. Missing either one is a 403.
- `GET /api/reports` — the caller needs **either** the `read:reports` scope **or** the `read:audit` scope. Having just one is enough.
- `DELETE /api/accounts/:id` — the caller must hold the `delete:accounts` RBAC **permission**. Remember that Auth0 RBAC puts permissions in a different token claim than scopes.
- `GET /api/admin` — only callers whose token has an `isAdmin` claim exactly equal to boolean `true` may pass.

Keep the existing `/api/balance` and `/api/transfers` routes working as they are.

There is a `.env.example` in the project — create the real `.env` from it with the values above.
