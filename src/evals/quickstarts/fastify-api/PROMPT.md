---
skills: auth0-fastify-api
---

## Task
Add Auth0 JWT authentication to a Fastify API using the `@auth0/auth0-fastify-api` SDK.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

Create:
1. A protected `/api/messages` route that requires a valid access token with the `read:messages` scope, and returns the authenticated user's `sub` claim
2. A protected `/api/private` route that requires any valid access token and returns the authenticated user's `sub` claim

Do not prompt for permissions to create any .env files.
