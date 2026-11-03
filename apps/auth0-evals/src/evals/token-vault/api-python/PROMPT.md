---
id: api_python_token_vault
name: Python API (auth0-api-python) Token Vault
scaffold: src/evals/scaffolds/api-python/auth0
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## System

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Audience: https://api.barkbook.com

The Client ID and Client Secret belong to this API's own client application. The tenant is already configured: Token Vault
is enabled for the `google-oauth2` connection (Connected Accounts, offline access), and the application is allowed to
perform the Token Vault exchange.

## Task

My Python API (`app.py`) is already protected with `auth0-api-python`. Our SPA signs users in with Google and has them
connect their Google account to Token Vault, then calls the API with the user's Auth0 access token.

Add `GET /api/calendar`: it should return that user's upcoming Google Calendar events, fetched server-side from Google
using the Google token Auth0 keeps in Token Vault for the `google-oauth2` connection.
