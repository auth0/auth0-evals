---
id: auth0_server_js_enterprise_connect
name: auth0-server-js Enterprise Connect Relay Login
scaffold: src/evals/scaffolds/auth0-server-js/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Our Express web app already has Auth0 login working through `@auth0/auth0-server-js`, and signed-in users get a server-side session. We are onboarding B2B enterprise customers who each bring their own identity provider (Okta, Microsoft Entra ID, and so on).

Add an enterprise single sign-on path: a user types their work email, and if that email domain belongs to one of our enterprise customers, send them to Auth0 so it federates to that company's identity provider and brings them back signed in. Route the user to the right company by their email domain.

In this enterprise mode Auth0 should act as a pure relay — it must not keep its own Auth0 session, and there are no refresh tokens. Our own application owns the session, exactly as it does today. Also make sure logging out ends the session at the enterprise identity provider, not just locally.

The Auth0 configuration is already in the environment.
