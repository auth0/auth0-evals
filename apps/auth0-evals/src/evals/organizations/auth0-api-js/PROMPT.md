---
id: auth0_api_js_organizations
name: auth0-api-js Organizations API Protection
scaffold: src/evals/scaffolds/auth0-api-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our Express API already verifies Auth0 access tokens using `@auth0/auth0-api-js`. Now, verify that every incoming access token carries a valid `org_id` claim,
reject tokens that do not belong to our "Acme" org (`org_barkbook_acme`), and include the
`org_id` in the API responses so clients can see which organization's data they are accessing.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com
Expected org: org_barkbook_acme
