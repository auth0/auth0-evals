---
id: auth0_express_enterprise_connect
name: Express (@auth0/auth0-express) Enterprise Connect Relay Login
scaffold: src/evals/scaffolds/auth0-express/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

My Express app already has Auth0 login working through `@auth0/auth0-express`, and signed-in users get a server-side session.

We are onboarding B2B enterprise customers who each bring their own identity provider. Add an enterprise sign-in: a user enters their work email, and if that domain belongs to an enterprise customer, send them to Auth0 so it federates to their company's identity provider by email domain and brings them back signed in.

In this enterprise mode Auth0 is a pure relay — it keeps no Auth0 session of its own and there are no refresh tokens, so my app has to establish and own the session after the callback. Logging out should also end the session at the enterprise identity provider.

Add the email-entry login, the callback that creates my app's session, and a federated logout. The Auth0 configuration is already in the environment.
