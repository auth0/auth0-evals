---
id: fastify_api_quickstart
name: Fastify API Quickstart
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## System

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

## Task
Add Auth0 authentication to my Fastify API.

I need two protected routes:
1. /api/messages — requires a valid token with the `read:messages` scope, returns the user's `sub` claim
2. /api/private — requires any valid token, returns the user's `sub` claim
