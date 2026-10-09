---
id: vue_mfa
name: Vue MFA Step-Up
displayable_prompt: Add MFA step-up to a Vue app's Transfer Funds feature using @auth0/auth0-vue so users must complete MFA before a transfer runs.
scaffold: src/evals/scaffolds/vue/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

My Vue app has Auth0 login set up. I want to add a Transfer Funds feature where users must complete MFA before the transfer runs. If they haven't done MFA yet, prompt them for it.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
