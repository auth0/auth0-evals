---
id: express_oidc_mfa
name: Express OpenID Connect MFA Step-Up
scaffold: src/evals/scaffolds/express-oidc/auth0
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## Task

My Express app has Auth0 login already set up using `express-openid-connect`. I want to add MFA step-up to the `/transfer` route so that users must have completed MFA before a transfer runs. If they haven't done MFA yet, redirect them to step up. After MFA is completed and the user returns, verify server-side that MFA was actually performed before allowing the transfer.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw

The `.env.example` file shows which environment variables are available. Create a `.env` file from it with the correct values.
