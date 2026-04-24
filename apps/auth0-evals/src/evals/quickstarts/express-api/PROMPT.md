---
skills: express-oauth2-jwt-bearer
---

## Task
Protect my Express.js API with Auth0.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

I need these routes:
- GET /api/messages — requires `read:messages` scope
- POST /api/messages — requires `write:messages` scope
- GET /api/profile — returns the user's info from the token (sub, scope)

All routes should validate JWT tokens. No token = 401. Valid token but wrong scope = 403.
