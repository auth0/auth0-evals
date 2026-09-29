---
id: swift_passkeys
name: Swift Passkey Sign-In & Signup
scaffold: src/evals/scaffolds/swift/auth0
skills: auth0
---

## Task

My iOS app already has Auth0 login working through Universal Login. The tenant and connection are already configured for passkeys — you only need to implement the app-side flows. I want to add passkeys — using Face ID or Touch ID on the device — so users can authenticate without a password. Existing users should be able to sign in with a passkey, and new users should be able to create an account with a passkey. Add both flows.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
