---
id: aspnetcore_api_mfa
name: ASP.NET Core API MFA Step-Up
scaffold: src/evals/scaffolds/aspnetcore-api/auth0
skills: auth0
---

## Task

My ASP.NET Core Web API validates Auth0 JWT access tokens. Transfers are a high-value action, so my tenant is configured to issue the `transfer:funds` scope only after the user completes MFA step-up. The API does not run MFA itself — its job is to enforce that only stepped-up callers can transfer, by requiring that scope.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

Requirements:
- Gate `POST /api/transfers` on the `transfer:funds` scope so that a caller whose token lacks it is rejected (a `403`). This is the step-up gate.
- Keep the existing `write:transfers` scope check on `POST /api/transfers`.
- Keep the existing `read:balance` scope check on `GET /api/balance` working.

Fill in the `Auth0` section of `appsettings.json` with the values above.
