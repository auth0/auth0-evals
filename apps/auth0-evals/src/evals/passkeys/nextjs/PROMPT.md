---
id: nextjs_passkeys
name: Next.js Passkey Enrollment, Sign-In & Signup
scaffold: src/evals/scaffolds/nextjs/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

My Next.js App Router app already has Auth0 login working through `@auth0/nextjs-auth0` v4, and signed-in users get a session. I want to add passkeys — letting people use the fingerprint, face, or screen lock on their device instead of a password — in three places:

- Let a user who is already signed in add a passkey to their existing account from the account settings page.
- Let returning users sign in with a passkey instead of a password.
- Let brand-new users create an account with a passkey.

Add all three, including the browser-side step that talks to the device authenticator. The Auth0 config is already in the environment.
