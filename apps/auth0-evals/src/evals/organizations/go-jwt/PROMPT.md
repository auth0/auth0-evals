---
id: go_jwt_organizations
name: Go API (go-jwt-middleware) Organizations
scaffold: src/evals/scaffolds/go-jwt/auth0
skills: auth0
---

## Task

My Go API is already protected with `go-jwt-middleware`. Add Auth0 Organizations support:

1. Restrict `GET /api/org/members` to users in the "Acme" org (`org_barkbook_acme`)
2. Add `GET /api/org/profile` that returns the organization the signed-in user belongs to

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com
