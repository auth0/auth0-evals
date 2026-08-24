---
id: spa_js_organizations
name: SPA JS Organizations Login
scaffold: src/evals/scaffolds/spa-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our vanilla JavaScript SPA already has Auth0 login working. Add Auth0 Organizations support: log users in to our "Acme" org (`org_barkbook_acme`), accept organization invitation links, and show which organization the signed-in user belongs to.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
