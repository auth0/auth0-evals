---
id: spa_js_passkeys
name: SPA JS Passkey Sign-Up and Sign-In
scaffold: src/evals/scaffolds/spa-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

My JavaScript SPA app already has Auth0 login working with @auth0/auth0-spa-js. I want to let people use passkeys instead of a password — new users should be able to sign up with a passkey and returning users should be able to sign in with one, using their device biometrics or screen lock. The tenant is already configured for passkeys.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
