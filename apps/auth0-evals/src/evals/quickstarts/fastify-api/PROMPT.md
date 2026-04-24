---
skills: auth0-fastify-api
---

## Task
Add Auth0 authentication to my Fastify API.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

I need two protected routes:
1. /api/messages — requires a valid token with the `read:messages` scope, returns the user's `sub` claim
2. /api/private — requires any valid token, returns the user's `sub` claim

Do not prompt for permissions to create any .env files.
