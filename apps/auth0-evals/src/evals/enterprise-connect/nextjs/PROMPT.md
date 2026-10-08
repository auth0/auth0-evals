---
id: nextjs_enterprise_connect
name: Next.js Enterprise Connect Relay Login
scaffold: src/evals/scaffolds/nextjs/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

My Next.js App Router app already has Auth0 login working through `@auth0/nextjs-auth0` v4, and signed-in users get a session.

We are adding B2B enterprise sign-in for customers who each use their own identity provider. When a user enters their work email, I want to send them to Auth0 so it federates to their company's identity provider by email domain and brings them back signed in.

In this enterprise mode Auth0 should behave as a pure relay: it keeps no Auth0 session of its own and there are no refresh tokens — my app has to establish and own the session after the callback. Logging out should also end the session at the enterprise identity provider.

Add the email-entry login, the callback handling that creates my app's session, and a federated logout. The Auth0 configuration is already in the environment.
