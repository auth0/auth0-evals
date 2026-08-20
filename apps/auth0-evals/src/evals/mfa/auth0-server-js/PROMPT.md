---
id: auth0_server_js_mfa
name: Auth0 Server JS MFA
scaffold: src/evals/scaffolds/auth0-server-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Barkbook's web app logs users in through Auth0 and calls our transfers API with an access token. We just turned on multi-factor authentication in our Auth0 tenant, and now getting that token fails for any user the policy applies to.

Add multi-factor support to the app:

- A user with no second factor yet should be walked through setting up an authenticator app, including showing them the QR code to scan.
- A user who already has an authenticator app should just be asked for the code from it.
- Some of our users enrolled with SMS instead — for them, send the code to their phone and let them type it in.
- After they submit a valid code, their session should be signed in, so /profile and the transfers call work without logging in again.
- If Auth0 gives us a recovery code during setup, show it to the user once.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Audience: https://api.barkbook.com
Base URL: http://localhost:3000
