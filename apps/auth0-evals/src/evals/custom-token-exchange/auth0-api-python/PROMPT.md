---
id: auth0_api_python_custom_token_exchange
name: Python API (auth0-api-python) Custom Token Exchange
scaffold: src/evals/scaffolds/auth0-api-python/auth0
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## Task

Our Barkbook API (`app.py`) protects its endpoints with the `auth0-api-python` SDK. We integrate with a
partner identity provider that issues its own short-lived tokens of type `urn:barkbook:external-idp-token`
for users already signed in on their side. Our backend needs to take one of those partner tokens and get
back an Auth0 access token for our own API (`https://api.barkbook.com`), with no interactive login.

Our tenant already has a token-exchange profile registered for the `urn:barkbook:external-idp-token`
subject token type.

Fill in the `/api/partner-exchange` handler so it exchanges the partner token the request carries for an
Auth0 access token for our API and returns that access token to the caller. The pre-configured
`api_client` in `auth0_client.py` is a confidential client and already holds the credentials it needs.
