---
id: auth0_auth_js_organizations
name: auth0-auth-js Organizations Login
scaffold: src/evals/scaffolds/auth0-auth-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our Node.js auth service already has Auth0 login working via `@auth0/auth0-auth-js`. Add Auth0
Organizations support: build authorization URLs scoped to our "Acme" org (`org_barkbook_acme`),
accept organization invitation links, validate the org claim
when exchanging the authorization code for tokens, and expose the logged-in organization (`org_id`)
from the ID token in the `/auth/callback` response.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
Redirect URI: http://localhost:3000/auth/callback
