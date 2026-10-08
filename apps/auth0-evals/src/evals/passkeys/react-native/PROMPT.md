---
id: react_native_passkeys
name: React Native Passkey Enrollment, Sign-In & Signup
scaffold: src/evals/scaffolds/react-native/auth0-passkeys
skills: auth0
---

## Task

My React Native app already has Auth0 login working through Universal Login, and it ships on iOS, Android, and web (react-native-web). The tenant and connection are already configured for passkeys — you only need to implement the app-side flows. I want to add passkeys — using the device's built-in authenticator (Face ID, Touch ID, Windows Hello, or the screen lock) — so users can authenticate without a password. Existing users should be able to sign in with a passkey, and new users should be able to create an account with a passkey. Add both flows.

- Let a user who is already signed in add a passkey to their existing account from the account settings screen.
- Let returning users sign in with a passkey instead of a password.
- Let brand-new users create an account with a passkey.

Add all three, and make them work on both the native (iOS/Android) and web builds — the WebAuthn ceremony is handled differently on each.

Domain: auth.barkbook.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
