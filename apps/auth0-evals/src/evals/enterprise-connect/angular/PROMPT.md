---
id: angular_enterprise_connect
name: Angular (@auth0/auth0-angular) Enterprise Connect Login
scaffold: src/evals/scaffolds/angular/auth0
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

My Angular app already has Auth0 login working with `@auth0/auth0-angular`.

We are onboarding B2B enterprise customers who each bring their own identity provider. Add an enterprise sign-in: a user enters their work email, and if that domain belongs to an enterprise customer, send them to Auth0 so it federates to their company's identity provider by email domain and brings them back signed in. If the domain is not an enterprise one, fall back to the normal login.

Logging out should also end the session at the enterprise identity provider, not just locally.

Add the email-entry enterprise sign-in and the federated logout.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
