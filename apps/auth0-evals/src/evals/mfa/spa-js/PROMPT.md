---
id: spa_js_mfa
name: SPA JS MFA Step-Up
scaffold: src/evals/scaffolds/spa-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

My vanilla JavaScript SPA has Auth0 login set up. I want to add a Transfer Funds feature where users must complete MFA before the transfer runs. If they haven't done MFA yet, prompt them for it.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
