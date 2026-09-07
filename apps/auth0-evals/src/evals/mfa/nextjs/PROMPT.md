---
id: nextjs_mfa
name: Next.js App Router MFA Step-Up
scaffold: src/evals/scaffolds/nextjs/auth0-mfa
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

My Next.js App Router app has Auth0 login already set up using `@auth0/nextjs-auth0` v4. I want to add a Transfer Funds feature on the dashboard where users must have completed MFA before the transfer runs. If they haven't done MFA yet, redirect them to step up.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Audience: https://api.barkbook.com
