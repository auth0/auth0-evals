---
skills: express-oauth2-jwt-bearer
---

## Task
Protect an Express.js API using the `express-oauth2-jwt-bearer` SDK for JWT Bearer token validation.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

Create an Express API with the following routes:
- `GET /api/messages` — protected, requires `read:messages` scope
- `POST /api/messages` — protected, requires `write:messages` scope
- `GET /api/profile` — protected, returns user profile info from the token payload (sub, scope)

All routes should be protected and validate JWT Bearer tokens. Requests without a valid token should receive a 401 response. Requests with a valid token but missing the required scope should receive a 403 response.
