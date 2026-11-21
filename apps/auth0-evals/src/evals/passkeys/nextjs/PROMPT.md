---
id: nextjs_passkeys
name: Next.js Passkey Enrollment, Sign-In & Signup
displayable_prompt: Add passkey enrollment, sign-in, and sign-up to a Next.js App Router app using @auth0/nextjs-auth0 v4, with challenges driven server-side in route handlers or server actions.
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

Add all three, including the browser-side step that talks to the device authenticator.

Drive the passkey ceremony from your own server code: request the challenges, run the token exchange, and enroll through the SDK's server-side passkey methods inside your own App Router route handlers or server actions, with only the WebAuthn call running in the browser. Keep the token exchange and the client secret on the server — don't hand the whole flow to a single client-side helper. The Auth0 config is already in the environment.
