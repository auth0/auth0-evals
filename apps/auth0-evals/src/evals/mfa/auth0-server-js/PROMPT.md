---
id: auth0_server_js_mfa
name: Auth0 Server JS MFA API
scaffold: src/evals/scaffolds/auth0-server-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Barkbook's web app signs users in against our Auth0 tenant and keeps them in a session. We just turned on multi-factor authentication, and now the transfers page blows up for any user the policy applies to.

Add the multi-factor step to the app, with our own pages rather than a hosted one:

- A user with no second factor yet should get an authenticator-app setup page showing a QR code they can scan.
- A user who already has a factor should be asked for the code from their app.
- Some of our users enrolled with SMS instead — send them their code and let them type it in.
- Once they submit a valid code, they should be properly signed in, so `/profile` and the transfers call work for the rest of the session.
- Show a user their recovery code once, when they first set a factor up.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Audience: https://api.barkbook.com
Base URL: http://localhost:3000
