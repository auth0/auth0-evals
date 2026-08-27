---
id: server_python_mfa
name: Python (auth0-server-python) MFA Step-Up
scaffold: src/evals/scaffolds/server-python/auth0
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## Task

My Python web app already has Auth0 login set up using the `auth0-server-python` SDK. I want to add a Transfer Funds feature where users must complete MFA before the transfer runs. If they haven't completed MFA in their current session, prompt them for it and only run the transfer once they have.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Base URL: http://localhost:8000
Audience: https://api.barkbook.com
