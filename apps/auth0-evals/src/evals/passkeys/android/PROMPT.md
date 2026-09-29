---
id: android_passkeys
name: Android Passkey Enrollment, Sign-In & Signup
scaffold: src/evals/scaffolds/android/auth0
skills: auth0
---

## Task

My Android app already has Auth0 login working through Universal Login, and signed-in users keep a stored session on the device. I want to add passkeys — using the device fingerprint or screen lock — in three places:

- Let a user who is already signed in add a passkey to their existing account from the account settings screen.
- Let returning users sign in with a passkey instead of a password.
- Let brand-new users create an account with a passkey.

Add all three.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
