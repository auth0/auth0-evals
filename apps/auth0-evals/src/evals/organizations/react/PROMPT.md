---
id: react_organizations
name: React Organizations Login
displayable_prompt: Add Auth0 Organizations support to a React app using @auth0/auth0-react — Acme org login, invitation links, and org membership display.
scaffold: src/evals/scaffolds/react/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our React app already has Auth0 login working. Add Auth0 Organizations support: log users in to our "Acme" org (`org_barkbook_acme`), accept organization invitation links, and show which organization the
signed-in user belongs to.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
