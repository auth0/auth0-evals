---
id: auth0_auth_js_passkeys
name: auth0-auth-js Passkey Sign-In & Signup
displayable_prompt: Add passkey sign-in and sign-up to a Node.js auth service using @auth0/auth0-auth-js, including both the browser-side WebAuthn step and server routes for returning and new users.
scaffold: src/evals/scaffolds/auth0-auth-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our Node.js auth service already signs users in with username and password through `@auth0/auth0-auth-js` and hands back tokens. Add passkeys so people can use the fingerprint, face, or screen lock on their device instead of a password, in two places:

- Let returning users sign in with a passkey.
- Let brand-new users create an account with a passkey.

Add both, including the browser-side step that talks to the device authenticator and the service routes it calls. The Auth0 config is already in the environment.
