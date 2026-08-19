---
id: express_api_dpop
name: Express API DPoP Enforcement
scaffold: src/evals/scaffolds/express-api/auth0
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## Task

My Express API already validates Auth0 JWT access tokens with express-oauth2-jwt-bearer. Our security review now requires sender-constrained tokens: the API must accept DPoP-proofed tokens only and reject plain Bearer tokens outright.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

Requirements:
- Reject plain Bearer tokens. Only tokens presented with the DPoP scheme (plus a valid DPoP proof) should be accepted.
- Allow a DPoP proof to be at most 2 minutes old, with 15 seconds of clock skew tolerance.
- The API runs behind an nginx TLS-terminating proxy, so make sure the DPoP proof's HTTP URI claim is validated against the original external URL rather than the internal one.
- Keep the existing `read:balance` and `write:transfers` scope checks working.

There is a `.env.example` in the project — create the real `.env` from it with the values above.
