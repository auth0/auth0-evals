---
id: express_api_mcd
name: Express API Multiple Custom Domains
scaffold: src/evals/scaffolds/express-api/auth0
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## Task

My Express API validates Auth0 JWT access tokens with express-oauth2-jwt-bearer against a single issuer. We are launching white-label brands, each on its own Auth0 custom domain, and all of them call this same API.

Audience: https://api.barkbook.com

The API must accept tokens from any of these three issuers:
- https://auth.barkbook.com
- https://auth.pawsome.com
- https://auth.woofworld.com

Requirements:
- Accept tokens from all three issuers, validating each against its own signing keys.
- Do not accept tokens from any other issuer.
- Keep the existing `read:balance` and `write:transfers` scope checks working.

The list of brands changes as we onboard partners, so read it from a `TRUSTED_ISSUERS` environment variable (comma-separated) rather than hardcoding the domains in the source.

There is a `.env.example` in the project — create the real `.env` from it. Note it ships the old single-issuer settings, so make sure `.env` ends up matching the new configuration.
