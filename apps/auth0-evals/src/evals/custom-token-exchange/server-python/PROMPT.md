---
id: server_python_custom_token_exchange
name: Python (auth0-server-python) Custom Token Exchange
scaffold: src/evals/scaffolds/server-python/auth0
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## Task

My Python web app already has Auth0 login set up using the `auth0-server-python` SDK. We also
integrate with a partner identity provider that hands us its own short-lived token for an
already-signed-in user. Add a `/partner-login` handler that trades that partner token for Auth0
tokens and establishes the user's Auth0 session, so the rest of the app treats them as logged in —
without sending them through a second interactive login.

Our tenant is already set up to accept these partner tokens: the token type is
`urn:barkbook:external-idp-token`.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Base URL: http://localhost:8000
Audience: https://api.barkbook.com
