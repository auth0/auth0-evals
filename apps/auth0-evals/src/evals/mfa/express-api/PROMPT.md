---
id: express_api_mfa
name: Express API MFA Step-Up
scaffold: src/evals/scaffolds/express-api/auth0
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## Task

My Express API validates Auth0 JWT access tokens with `express-oauth2-jwt-bearer`. Transfers are a high-value action, so my tenant is configured to issue the `transfer:funds` scope only after the user completes MFA step-up. The API does not run MFA itself — its job is to enforce that only stepped-up callers can transfer, by requiring that scope.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

Requirements:
- Gate `POST /api/transfers` on the `transfer:funds` scope so that a caller whose token lacks it is rejected (the SDK returns a `403` `insufficient_scope`). This is the step-up gate.
- Keep the existing `write:transfers` scope check on `POST /api/transfers`.
- Keep the existing `read:balance` scope check on `GET /api/balance` working.

There is a `.env.example` in the project — create the real `.env` from it with the values above.
