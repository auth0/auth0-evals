---
id: spring_security_api_mfa
name: Spring Boot API MFA Step-Up
scaffold: src/evals/scaffolds/spring-security-api/auth0
skills: auth0
---

## Task

My Spring Boot API validates Auth0 JWT access tokens as an OAuth2 resource server. Transfers are a high-value action, so my tenant is configured to issue the `transfer:funds` scope only after the user completes MFA step-up. The API does not run MFA itself — its job is to enforce that only stepped-up callers can transfer, by requiring that scope.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

Requirements:
- Gate `POST /api/transfers` on the `transfer:funds` scope so that a caller whose token lacks it is rejected (a `403`). This is the step-up gate.
- Keep the existing `write:transfers` scope check on `POST /api/transfers`.
- Keep the existing `read:balance` scope check on `GET /api/balance` working.

Fill in `src/main/resources/application.yml` with the issuer and audience values above.
