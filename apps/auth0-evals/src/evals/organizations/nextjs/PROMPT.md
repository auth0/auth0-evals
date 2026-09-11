---
id: nextjs_organizations
name: Next.js App Router Organizations Login
scaffold: src/evals/scaffolds/nextjs/auth0-mfa
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

My Next.js App Router app already has Auth0 login set up using `@auth0/nextjs-auth0` v4. Add Auth0 Organizations support: log users in to our "Acme" org (`org_barkbook_acme`), accept organization invitation links, and show which organization the signed-in user belongs to on the dashboard page.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Audience: https://api.barkbook.com
