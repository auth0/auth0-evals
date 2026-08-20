---
id: auth0_auth_js_mfa
name: Auth0 Auth JS MFA
scaffold: src/evals/scaffolds/auth0-auth-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Barkbook's auth service signs users in with their username and password and hands back tokens. We just turned on multi-factor authentication in our Auth0 tenant, and now sign-in fails for any user the policy applies to.

Add multi-factor support to the service, as HTTP routes my mobile client can drive:

- A user who has no second factor yet should be able to set up an authenticator app — return whatever the app needs to show a QR code.
- A user who already has a factor should be prompted for the code from their app instead.
- Either way, once they submit a valid code, sign-in finishes and we hand back tokens like we do today.
- Someone who has lost their phone should be able to finish sign-in with a recovery code.
- Let a user see the factors on their account and remove one they no longer use.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Audience: https://api.barkbook.com
