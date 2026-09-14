---
id: server_python_mfa
name: Python (auth0-server-python) MFA API
scaffold: src/evals/scaffolds/server-python/auth0
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## Task

My Python web app already has Auth0 login set up using the `auth0-server-python` SDK. I want to add a Transfer Funds feature that runs only after the user completes MFA.

When the app requests an access token for the transfer, Auth0 signals that a second factor is required — the SDK raises `MfaRequiredError` carrying an `mfa_token`. Handle that through the SDK's MFA API, not a hosted redirect: read the `mfa_token` off the error, list the user's enrolled authenticators (enrolling one if they have none), challenge the factor, and finish with `verify` using the one-time code. Persist the session on success so the transfer runs and the user stays signed in for the rest of the session.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Base URL: http://localhost:8000
Audience: https://api.barkbook.com
