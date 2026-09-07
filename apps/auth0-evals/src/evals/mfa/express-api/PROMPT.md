---
id: express_api_mfa
name: Express API MFA Step-Up
scaffold: src/evals/scaffolds/express-api/auth0
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## Task

My Express API validates Auth0 JWT access tokens with `express-oauth2-jwt-bearer`. I need to gate the `POST /api/transfers` route behind MFA step-up: only callers whose access token contains `"mfa"` in the `amr` claim may execute a transfer.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

Requirements:
- Protect `POST /api/transfers` so that requests where `amr` does not include `"mfa"` are rejected with a `403` response and a JSON body containing `code: "mfa_required"`.
- Keep the existing `read:balance` scope check on `GET /api/balance` working.
- Keep the existing `write:transfers` scope check on `POST /api/transfers` working (MFA check comes on top of it).

Note: Auth0 requires a custom Action to add the `amr` claim to access tokens. Assume the tenant already has this Action configured.

There is a `.env.example` in the project — create the real `.env` from it with the values above.
