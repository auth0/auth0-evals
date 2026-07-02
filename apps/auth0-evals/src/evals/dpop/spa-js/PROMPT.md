---
id: spa_js_dpop
name: SPA JS DPoP Token Binding
scaffold: src/evals/scaffolds/spa-js/auth0
skills: auth0-dpop
setup_command: npm install
compile_command: npm run build
---

## Task

My vanilla JavaScript SPA uses @auth0/auth0-spa-js for authentication. I want to add DPoP token binding so my API calls are protected against token replay attacks.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
