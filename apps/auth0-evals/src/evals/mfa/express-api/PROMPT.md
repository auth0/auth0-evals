---
id: express_api_mfa
name: Express API MFA Step-Up
scaffold: src/evals/mfa/express-api/scaffold
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## System

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

There is a `.env.example` in the project — create the real `.env` from it with the values above.

## Task

My Express API validates Auth0 access tokens. Here is how my Auth0 tenant is set up:

- Customers must complete MFA before they can transfer funds.
- After a customer completes MFA, a tenant Action adds the `transfer:funds` scope to their access token.
- Reading a balance (`GET /api/balance`) needs the `read:balance` scope.
- Making a transfer (`POST /api/transfers`) needs the `write:transfers` scope.

Update the API so it enforces these rules.
