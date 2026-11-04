---
id: spa_js_custom_token_exchange
name: SPA JS Custom Token Exchange
scaffold: src/evals/scaffolds/spa-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our vanilla JavaScript SPA already has Auth0 login working. We also integrate with a partner identity provider that hands our frontend its own short-lived token for an already-signed-in user. Instead of sending those users through a second interactive login, we want to trade that partner token for Auth0 tokens and establish the usual Auth0 session, so the rest of the app behaves exactly as it does after a normal login.

Our tenant is already set up to accept these partner tokens: the token type is `urn:barkbook:external-idp-token`. Add a "Continue with Partner" action that takes the partner token the app already holds and signs the user in with it.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
