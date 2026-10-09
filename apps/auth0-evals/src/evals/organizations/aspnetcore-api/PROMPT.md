---
id: aspnetcore_api_organizations
name: ASP.NET Core API (Auth0.AspNetCore.Authentication.Api) Organizations
displayable_prompt: Add Organizations support to an ASP.NET Core API — restrict a members endpoint to the Acme org and expose org profile data.
scaffold: src/evals/scaffolds/aspnetcore-api/auth0
skills: auth0
---

## Task

My ASP.NET Core API is already protected with `Auth0.AspNetCore.Authentication.Api`. Add Auth0 Organizations support:

1. Restrict `GET /api/org/members` to users in the "Acme" org (`org_barkbook_acme`)
2. Add `GET /api/org/profile` that returns the organization the signed-in user belongs to

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com
