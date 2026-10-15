---
id: android_passkeys
name: Android Passkey Enrollment, Sign-In & Signup
scaffold: src/evals/scaffolds/android/auth0
skills: auth0
---

## System

Domain: auth.barkbook.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com

## Task

My Android app already has Auth0 login working through Universal Login. The tenant and connection are already configured for passkeys — you only need to implement the app-side flows. I want to add passkeys — using the device fingerprint or screen lock — so users can authenticate without a password. Existing users should be able to sign in with a passkey, and new users should be able to create an account with a passkey. Add both flows.

- Let a user who is already signed in add a passkey to their existing account from the account settings screen.
- Let returning users sign in with a passkey instead of a password.
- Let brand-new users create an account with a passkey.

Add all three.
