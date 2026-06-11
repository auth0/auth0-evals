---
id: nextjs_mfa
name: Next.js MFA Step-Up
scaffold: src/evals/scaffolds/nextjs/auth0
skills: auth0-nextjs,auth0-mfa
setup_command: npm install
---

## Task

My Next.js app (App Router) already has Auth0 login set up. I want to add a Transfer Funds
feature where the user must complete MFA before the transfer runs. If they haven't completed
MFA yet, prompt them for it.

Requirements:
- The transfer is authorized by calling a protected API with audience https://api.barkbook.com.
- The access token used to call that API must stay on the server — the browser must never
  receive or store it.
- When MFA is required, prompt the user with a popup so they are not redirected away from the
  page. After they complete MFA, the transfer should proceed.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
