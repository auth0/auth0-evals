---
id: android_mfa
name: Android MFA Step-Up
scaffold: src/evals/scaffolds/android/auth0
skills: auth0
---

## Task

My Android app signs users in against a database connection with the Authentication API (`AuthenticationAPIClient`). Accounts with MFA enabled don't return credentials on login — the login call fails with an "MFA required" error instead. I need to handle that in-app: read the `mfaToken` off the error, then complete MFA through the SDK's MFA API — challenge an enrolled authenticator and verify the one-time code (enrolling a factor first if the user has none) — so login finishes and the credentials are stored.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
