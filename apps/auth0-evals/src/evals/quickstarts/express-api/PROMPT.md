---
id: express_api_quickstart
name: Express API Quickstart
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## System

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

## Task
Protect my Express.js API with Auth0.

I need these routes:
- GET /api/messages — requires `read:messages` scope
- POST /api/messages — requires `write:messages` scope
- GET /api/profile — returns the user's info from the token (sub, scope)

All routes should validate JWT tokens. No token = 401. Valid token but wrong scope = 403.
