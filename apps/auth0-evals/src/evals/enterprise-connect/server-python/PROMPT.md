---
id: server_python_enterprise_connect
name: Python (auth0-server-python) Enterprise Connect Relay Login
scaffold: src/evals/scaffolds/server-python/auth0
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## Task

My Python web app already has Auth0 login working with the `auth0-server-python` SDK, and signed-in users get a server-side session.

We are onboarding B2B enterprise customers who each bring their own identity provider. Add an enterprise sign-in: a user enters their work email, and if that domain belongs to an enterprise customer, send them to Auth0 so it federates to their company's identity provider by email domain and brings them back signed in.

In this enterprise mode Auth0 is a pure relay — it keeps no Auth0 session of its own and there are no refresh tokens, so my app has to establish and own the session after the callback. Logging out should also end the session at the enterprise identity provider.

Add the email-entry login, the callback that creates my app's session, and a federated logout.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Base URL: http://localhost:8000
