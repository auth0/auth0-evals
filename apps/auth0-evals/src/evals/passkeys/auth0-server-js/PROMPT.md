---
id: auth0_server_js_passkeys
name: auth0-server-js Passkey Sign-In & Signup
scaffold: src/evals/scaffolds/auth0-server-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our Express web app already has Auth0 login working through `@auth0/auth0-server-js` and keeps signed-in users in a session. Add passkeys so people can use the fingerprint, face, or screen lock on their device instead of a password, in two places:

- Let returning users sign in with a passkey.
- Let brand-new users create an account with a passkey.

Add both, including the browser-side step that talks to the device authenticator. A user who signs in with a passkey should end up in the same server-side session they get today. The Auth0 config is already in the environment.
